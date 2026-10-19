<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;

class WeatherController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $coordinates = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        try {
            $response = Http::acceptJson()
                ->timeout(8)
                ->get('https://api.open-meteo.com/v1/forecast', [
                    'latitude' => $coordinates['latitude'],
                    'longitude' => $coordinates['longitude'],
                    'current' => 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
                    'timezone' => 'auto',
                ])
                ->throw();
        } catch (ConnectionException|RequestException $exception) {
            Log::warning('Weather provider request failed.', ['exception' => $exception::class]);

            return response()->json(['message' => 'Live weather is temporarily unavailable. Please try again.'], 503);
        }

        $current = $response->json('current');
        $numericFields = [
            'temperature_2m',
            'apparent_temperature',
            'relative_humidity_2m',
            'wind_speed_10m',
            'weather_code',
            'is_day',
        ];
        if (
            ! is_array($current)
            || ! is_string($current['time'] ?? null)
            || collect($numericFields)->contains(
                fn (string $field): bool => ! is_numeric($current[$field] ?? null)
            )
        ) {
            Log::warning('Weather provider returned an unexpected response shape.');

            return response()->json(['message' => 'Live weather is temporarily unavailable. Please try again.'], 503);
        }

        return response()->json([
            'temperature' => (float) $current['temperature_2m'],
            'apparent_temperature' => (float) $current['apparent_temperature'],
            'humidity' => (int) $current['relative_humidity_2m'],
            'wind_speed' => (float) $current['wind_speed_10m'],
            'weather_code' => (int) $current['weather_code'],
            'is_day' => (int) $current['is_day'],
            'time' => $current['time'],
        ]);
    }
}
