<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rules\Password;

class AuthController extends Controller
{
    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:100'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::min(8)->letters()->numbers()],
        ]);

        $user = User::create($validated);
        Auth::login($user);
        $request->session()->regenerate();

        return response()->json(['user' => $this->publicUser($user)], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255'],
            'password' => ['required', 'string', 'max:200'],
        ]);

        if (! Auth::validate($validated)) {
            return response()->json(['message' => 'The provided credentials are incorrect.'], 422);
        }

        $user = User::where('email', $validated['email'])->firstOrFail();
        if ($user->mfa_enabled) {
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            $request->session()->put('mfa.pending_user_id', $user->id);
            $request->session()->put('mfa.pending_until', now()->addMinutes(5)->timestamp);

            return response()->json(['requires_mfa' => true]);
        }

        Auth::login($user);
        $request->session()->regenerate();

        return response()->json(['user' => $this->publicUser($user)]);
    }

    public function loginMfa(Request $request): JsonResponse
    {
        $validated = $request->validate(['code' => ['required', 'digits:6']]);
        $userId = $request->session()->get('mfa.pending_user_id');
        $expiresAt = $request->session()->get('mfa.pending_until', 0);

        if ($expiresAt < now()->timestamp) {
            $request->session()->forget(['mfa.pending_user_id', 'mfa.pending_until']);
        }

        if ($expiresAt < now()->timestamp || ! $userId || ! $this->verifyCode((int) $userId, $validated['code'])) {
            return response()->json(['message' => 'The verification code is invalid or expired.'], 422);
        }

        $user = User::findOrFail($userId);
        Auth::login($user);
        $request->session()->forget(['mfa.pending_user_id', 'mfa.pending_until']);
        $request->session()->regenerate();

        return response()->json(['user' => $this->publicUser($user)]);
    }

    public function user(Request $request): JsonResponse
    {
        return response()->json($this->publicUser($request->user()));
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Signed out.']);
    }

    private function verifyCode(int $userId, string $code): bool
    {
        return DB::transaction(function () use ($userId, $code): bool {
            $user = User::query()->lockForUpdate()->find($userId);
            if (! $user || ! $user->mfa_enabled || ! $user->mfa_secret) {
                return false;
            }

            $timestamp = app('pragmarx.google2fa')->verifyKeyNewer(
                $user->mfa_secret,
                $code,
                (int) ($user->mfa_last_used_at ?? 0),
                1,
            );

            if ($timestamp === false) {
                return false;
            }

            $user->forceFill(['mfa_last_used_at' => $timestamp])->save();

            return true;
        });
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
