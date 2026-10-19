<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\MfaController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\WeatherController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:login');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/mfa/login', [AuthController::class, 'loginMfa'])->middleware('throttle:mfa');
Route::post('/forgot-password', [PasswordResetController::class, 'sendLink'])->middleware('throttle:password-reset');
Route::post('/reset-password', [PasswordResetController::class, 'reset'])->middleware('throttle:password-reset');

Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/weather', [WeatherController::class, 'show'])->middleware('throttle:60,1');
    Route::post('/mfa/setup', [MfaController::class, 'setup'])->middleware('throttle:mfa-management');
    Route::post('/mfa/confirm', [MfaController::class, 'confirm'])->middleware('throttle:mfa-management');
    Route::post('/mfa/disable', [MfaController::class, 'disable'])->middleware('throttle:mfa-management');
});
