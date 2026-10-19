<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MfaController extends Controller
{
    public function setup(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        if ($user->mfa_enabled) {
            return response()->json(['message' => 'Two-factor authentication is already enabled.'], 409);
        }

        $secret = app('pragmarx.google2fa')->generateSecretKey();
        $user->forceFill([
            'mfa_pending_secret' => $secret,
            'mfa_pending_expires_at' => now()->addMinutes(10),
        ])->save();
        $uri = app('pragmarx.google2fa')->getQRCodeUrl(config('app.name'), $user->email, $secret);

        return response()->json(['uri' => $uri, 'secret' => $secret]);
    }

    public function confirm(Request $request): JsonResponse
    {
        $validated = $request->validate(['code' => ['required', 'digits:6']]);
        $user = DB::transaction(function () use ($request, $validated): ?User {
            /** @var User $user */
            $user = User::query()->lockForUpdate()->findOrFail($request->user()->id);
            $secret = $user->mfa_pending_secret;
            if ($user->mfa_pending_expires_at?->isPast()) {
                $user->forceFill([
                    'mfa_pending_secret' => null,
                    'mfa_pending_expires_at' => null,
                ])->save();

                return null;
            }
            $timestamp = $secret
                ? app('pragmarx.google2fa')->verifyKeyNewer($secret, $validated['code'], 0, 1)
                : false;

            if ($timestamp === false || $user->mfa_enabled) {
                return null;
            }

            $user->forceFill([
                'mfa_secret' => $secret,
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
                'mfa_enabled' => true,
                'mfa_last_used_at' => $timestamp,
            ])->save();

            return $user;
        });

        if (! $user) {
            return response()->json(['message' => 'The authenticator code is invalid or expired.'], 422);
        }

        return response()->json(['user' => $this->publicUser($user)]);
    }

    public function disable(Request $request): JsonResponse
    {
        $validated = $request->validate(['code' => ['required', 'digits:6']]);
        $user = DB::transaction(function () use ($request, $validated): ?User {
            /** @var User $user */
            $user = User::query()->lockForUpdate()->findOrFail($request->user()->id);
            $timestamp = $user->mfa_enabled && $user->mfa_secret
                ? app('pragmarx.google2fa')->verifyKeyNewer(
                    $user->mfa_secret,
                    $validated['code'],
                    (int) ($user->mfa_last_used_at ?? 0),
                    1,
                )
                : false;

            if ($timestamp === false) {
                return null;
            }

            $user->forceFill([
                'mfa_secret' => null,
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
                'mfa_enabled' => false,
                'mfa_last_used_at' => null,
            ])->save();

            return $user;
        });

        if (! $user) {
            return response()->json(['message' => 'The authenticator code is invalid or expired.'], 422);
        }

        return response()->json(['user' => $this->publicUser($user)]);
    }

    private function publicUser(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'mfa_enabled' => $user->mfa_enabled,
        ];
    }
}
