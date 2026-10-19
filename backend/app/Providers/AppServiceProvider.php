<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        ResetPassword::createUrlUsing(function (object $user, string $token): string {
            return rtrim((string) config('app.frontend_url'), '/')
                .'/?token='.urlencode($token)
                .'&email='.urlencode($user->getEmailForPasswordReset());
        });

        RateLimiter::for('login', function (Request $request): Limit {
            $email = strtolower((string) $request->input('email'));

            return Limit::perMinute(5)->by($email.'|'.$request->ip());
        });

        RateLimiter::for('mfa', function (Request $request): Limit {
            return Limit::perMinute(5)->by('mfa|'.$request->ip());
        });

        RateLimiter::for('password-reset', function (Request $request): Limit {
            $email = strtolower((string) $request->input('email'));

            return Limit::perMinute(3)->by($email.'|'.$request->ip());
        });

        RateLimiter::for('mfa-management', function (Request $request): Limit {
            return Limit::perMinute(5)->by((string) $request->user()?->getAuthIdentifier().'|'.$request->ip());
        });
    }
}
