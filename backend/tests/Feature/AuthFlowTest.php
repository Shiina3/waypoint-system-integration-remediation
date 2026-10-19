<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

class AuthFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_creates_hashed_password_and_authenticated_session(): void
    {
        $response = $this->withHeader('Origin', 'http://localhost:3000')->postJson('/api/register', [
            'name' => 'Alex Morgan',
            'email' => 'alex@example.test',
            'password' => 'ExamplePass123',
            'password_confirmation' => 'ExamplePass123',
        ]);

        $response->assertCreated()
            ->assertJsonPath('user.email', 'alex@example.test')
            ->assertJsonPath('user.mfa_enabled', false);

        $user = User::where('email', 'alex@example.test')->firstOrFail();
        $this->assertNotSame('ExamplePass123', $user->password);
        $this->assertTrue(password_verify('ExamplePass123', $user->password));
        $this->getJson('/api/user')->assertOk()->assertJsonPath('id', $user->id);
    }

    public function test_dashboard_profile_is_rejected_without_authentication(): void
    {
        $this->withHeader('Origin', 'http://localhost:3000')->getJson('/api/user')->assertUnauthorized();
    }

    public function test_login_and_logout_manage_the_session(): void
    {
        $user = User::factory()->create([
            'email' => 'alex@example.test',
            'password' => 'ExamplePass123',
        ]);

        $this->withHeader('Origin', 'http://localhost:3000')->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'ExamplePass123',
        ])->assertOk()->assertJsonPath('user.id', $user->id);

        $this->withHeader('Origin', 'http://localhost:3000')
            ->postJson('/api/logout')
            ->assertOk();
        $this->assertGuest('web');
    }

    public function test_mfa_login_accepts_a_code_once_and_rejects_replay(): void
    {
        $secret = app('pragmarx.google2fa')->generateSecretKey();
        $alreadySignedIn = User::factory()->create();
        $user = User::factory()->create([
            'email' => 'mfa@example.test',
            'password' => 'ExamplePass123',
            'mfa_secret' => $secret,
            'mfa_enabled' => true,
            'mfa_last_used_at' => 0,
        ]);
        $code = app('pragmarx.google2fa')->getCurrentOtp($secret);

        $this->actingAs($alreadySignedIn)
            ->withHeader('Origin', 'http://localhost:3000')
            ->postJson('/api/login', ['email' => $user->email, 'password' => 'ExamplePass123'])
            ->assertOk()
            ->assertJsonPath('requires_mfa', true);

        $this->getJson('/api/user')->assertUnauthorized();

        $this->postJson('/api/mfa/login', ['code' => $code])
            ->assertOk()
            ->assertJsonPath('user.id', $user->id);

        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'ExamplePass123'])
            ->assertOk()
            ->assertJsonPath('requires_mfa', true);

        $this->postJson('/api/mfa/login', ['code' => $code])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The verification code is invalid or expired.');
    }

    public function test_password_reset_token_changes_password_and_is_invalidated(): void
    {
        $user = User::factory()->create([
            'email' => 'reset@example.test',
            'password' => 'ExamplePass123',
        ]);
        $token = Password::createToken($user);

        $this->postJson('/api/reset-password', [
            'email' => $user->email,
            'token' => $token,
            'password' => 'NewExample456',
            'password_confirmation' => 'NewExample456',
        ])->assertOk();

        $this->assertTrue(password_verify('NewExample456', $user->fresh()->password));
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => $user->email]);

        $this->postJson('/api/reset-password', [
            'email' => $user->email,
            'token' => $token,
            'password' => 'AnotherExample789',
            'password_confirmation' => 'AnotherExample789',
        ])->assertUnprocessable();
    }

    public function test_password_recovery_response_does_not_reveal_account_existence(): void
    {
        User::factory()->create(['email' => 'known@example.test']);

        $known = $this->postJson('/api/forgot-password', ['email' => 'known@example.test']);
        $unknown = $this->postJson('/api/forgot-password', ['email' => 'unknown@example.test']);

        $known->assertOk()->assertJsonPath(
            'message',
            'If an account matches, a password reset link will be sent shortly.',
        );
        $unknown->assertOk()->assertExactJson($known->json());
    }

    public function test_weather_endpoint_validates_coordinates_and_returns_provider_data(): void
    {
        Http::fake([
            'api.open-meteo.com/*' => Http::response([
                'current' => [
                    'temperature_2m' => 21.5,
                    'apparent_temperature' => 20.2,
                    'relative_humidity_2m' => 65,
                    'wind_speed_10m' => 9.1,
                    'weather_code' => 2,
                    'is_day' => 1,
                    'time' => '2026-10-19T11:00',
                ],
            ]),
        ]);
        $user = User::factory()->create();

        $this->actingAs($user)->getJson('/api/weather?latitude=14.5995&longitude=120.9842')
            ->assertOk()
            ->assertJsonPath('temperature', 21.5)
            ->assertJsonPath('weather_code', 2);

        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'api.open-meteo.com/v1/forecast'));

        $this->actingAs($user)->getJson('/api/weather?latitude=91&longitude=120')
            ->assertUnprocessable();
    }

    public function test_mfa_setup_secret_is_encrypted_and_enabled_only_after_code_verification(): void
    {
        $user = User::factory()->create();

        $setup = $this->actingAs($user)
            ->withHeader('Origin', 'http://localhost:3000')
            ->postJson('/api/mfa/setup')
            ->assertOk()
            ->assertJsonStructure(['uri', 'secret']);

        $secret = $setup->json('secret');
        $user->refresh();
        $this->assertTrue($user->mfa_pending_secret === $secret);
        $this->assertNotSame($secret, $user->getRawOriginal('mfa_pending_secret'));

        $code = app('pragmarx.google2fa')->getCurrentOtp($secret);
        $this->postJson('/api/mfa/confirm', ['code' => $code])
            ->assertOk()
            ->assertJsonPath('user.mfa_enabled', true);

        $this->assertNull($user->fresh()->mfa_pending_secret);
        $this->assertTrue($user->fresh()->mfa_enabled);
    }
}
