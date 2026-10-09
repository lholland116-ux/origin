<?php
declare(strict_types=1);

// Site A's PHP caller targets only the explicitly approved Site B temporary
// Hostinger hostname in this private allowlist file.
const SITE_A_HOST = 'darkblue-bear-768036.hostingersite.com';
const PROBE_HOST_FILE = __DIR__ . '/probe-host.allow';
const PROBE_KEY_FILE = __DIR__ . '/https-probe.key';
const PROBE_SKEW_SECONDS = 300;
const PROBE_PATH = '/api/internal/execution-wake';

function emitResult(string $case, array $results, int $exitCode): never
{
    echo json_encode(
        ['component' => 'hostinger_probe_caller', 'case' => $case, 'results' => $results],
        JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . PHP_EOL;
    exit($exitCode);
}

function approvedProbeOrigin(): ?string
{
    if (is_link(PROBE_HOST_FILE) || !is_file(PROBE_HOST_FILE)) {
        return null;
    }
    $permissions = @fileperms(PROBE_HOST_FILE);
    if (!is_int($permissions) || (($permissions & 0077) !== 0)) {
        return null;
    }
    $host = strtolower(trim((string)@file_get_contents(PROBE_HOST_FILE)));
    $isApprovedTemporaryHost = preg_match(
        '/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:hostingersite\.com|hostinger-site\.com)$/D',
        $host
    ) === 1;
    if (!$isApprovedTemporaryHost || $host === SITE_A_HOST) {
        return null;
    }
    return 'https://' . $host;
}

function requestProbe(string $origin, string $path, string $timestamp, string $nonce, ?string $signature): array
{
    $headers = ['Content-Length: 0', 'Connection: close'];
    if ($signature !== null) {
        $headers[] = 'x-lvtchat-timestamp: ' . $timestamp;
        $headers[] = 'x-lvtchat-nonce: ' . $nonce;
        $headers[] = 'x-lvtchat-signature: ' . $signature;
    }
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers),
            'content' => '',
            'timeout' => 135,
            'ignore_errors' => true,
            'follow_location' => 0,
            'max_redirects' => 0,
            'protocol_version' => 1.1,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'allow_self_signed' => false,
        ],
    ]);

    $started = hrtime(true);
    $body = @file_get_contents($origin . $path, false, $context);
    $responseHeaders = isset($http_response_header) && is_array($http_response_header)
        ? $http_response_header
        : [];
    unset($body, $context);

    $status = null;
    foreach ($responseHeaders as $header) {
        if (preg_match('/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/', $header, $matches) === 1) {
            $status = (int)$matches[1];
        }
    }
    return [
        'http_status' => $status,
        'duration_ms' => (int)round((hrtime(true) - $started) / 1_000_000),
    ];
}

function signedRequest(string $origin, string $path, string $secret, string $kind = 'valid'): array
{
    $timestamp = $kind === 'stale'
        ? (string)(time() - PROBE_SKEW_SECONDS - 1)
        : (string)time();
    $nonce = bin2hex(random_bytes(16));
    $signable = "v1\nPOST\n" . $path . "\n" . $timestamp . "\n" . strtolower($nonce);
    $signature = hash_hmac('sha256', $signable, $secret);
    if ($kind === 'invalid') {
        $signature = ($signature[0] === '0' ? '1' : '0') . substr($signature, 1);
    }

    $copies = $kind === 'replay' ? 2 : 1;
    $expected = match ($kind) {
        'invalid', 'stale' => [401],
        'replay' => [200, 409],
        default => [200],
    };
    $results = [];
    $passed = true;
    for ($index = 0; $index < $copies; $index += 1) {
        $result = requestProbe($origin, $path, $timestamp, $nonce, $signature);
        $results[] = $result;
        if ($result['http_status'] !== $expected[$index]) {
            $passed = false;
        }
    }
    unset($nonce, $signable, $signature);
    return ['results' => $results, 'passed' => $passed];
}

function concurrentRequests(string $origin, array $requests, string $secret): array
{
    if (!function_exists('curl_multi_init')) {
        return ['available' => false, 'results' => []];
    }

    $multi = curl_multi_init();
    $handles = [];
    $startedAt = [];
    foreach ($requests as $request) {
        $timestamp = (string)time();
        $nonce = bin2hex(random_bytes(16));
        $signable = "v1\nPOST\n" . $request['path'] . "\n" . $timestamp . "\n" . strtolower($nonce);
        $signature = hash_hmac('sha256', $signable, $secret);
        $handle = curl_init($origin . $request['path']);
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => '',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Length: 0',
                'x-lvtchat-timestamp: ' . $timestamp,
                'x-lvtchat-nonce: ' . $nonce,
                'x-lvtchat-signature: ' . $signature,
                'Connection: close',
            ],
            CURLOPT_TIMEOUT => 135,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        curl_multi_add_handle($multi, $handle);
        $handles[] = ['case' => $request['case'], 'handle' => $handle];
        $startedAt[] = hrtime(true);
        unset($nonce, $signable, $signature);
    }

    $running = null;
    do {
        $multiStatus = curl_multi_exec($multi, $running);
        if ($multiStatus !== CURLM_OK) {
            break;
        }
        if ($running > 0 && curl_multi_select($multi, 1.0) === -1) {
            usleep(100_000);
        }
    } while ($running > 0);

    $results = [];
    foreach ($handles as $index => $entry) {
        $handle = $entry['handle'];
        $responseBody = curl_multi_getcontent($handle);
        unset($responseBody);
        $results[] = [
            'case' => $entry['case'],
            'http_status' => (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE),
            'duration_ms' => (int)round((hrtime(true) - $startedAt[$index]) / 1_000_000),
        ];
        curl_multi_remove_handle($multi, $handle);
        curl_close($handle);
    }
    curl_multi_close($multi);
    return ['available' => true, 'results' => $results];
}

function privateTestSecret(): ?string
{
    if (is_link(PROBE_KEY_FILE) || !is_file(PROBE_KEY_FILE)) {
        return null;
    }
    $permissions = @fileperms(PROBE_KEY_FILE);
    if (!is_int($permissions) || (($permissions & 0077) !== 0)) {
        return null;
    }
    $secret = @file_get_contents(PROBE_KEY_FILE);
    if (!is_string($secret)) {
        return null;
    }
    $secret = rtrim($secret, "\r\n");
    return strlen($secret) >= 32 ? $secret : null;
}

$case = $argv[1] ?? 'valid';
$singleCases = [
    'valid', 'invalid-signature', 'stale-timestamp', 'replay', 'missing-key', 'missing-auth',
    'overlap', 'delay-5', 'delay-30', 'delay-60', 'delay-90', 'delay-120',
];
if (!in_array($case, [...$singleCases, 'auth-suite', 'delay-suite'], true)) {
    emitResult('invalid-case', [], 2);
}
$probeOrigin = approvedProbeOrigin();
if ($probeOrigin === null) {
    emitResult('unsafe-target', [], 2);
}

if ($case === 'missing-key') {
    $result = requestProbe($probeOrigin, PROBE_PATH, (string)time(), '', null);
    emitResult($case, [$result], $result['http_status'] === 503 ? 0 : 1);
}
if ($case === 'missing-auth') {
    $result = requestProbe($probeOrigin, PROBE_PATH, (string)time(), '', null);
    emitResult($case, [$result], $result['http_status'] === 401 ? 0 : 1);
}

$secret = privateTestSecret();
if ($secret === null) {
    emitResult('key_unavailable', [], 2);
}

if ($case === 'auth-suite') {
    $suite = [
        ['case' => 'valid', 'kind' => 'valid'],
        ['case' => 'invalid-signature', 'kind' => 'invalid'],
        ['case' => 'stale-timestamp', 'kind' => 'stale'],
        ['case' => 'missing-auth', 'kind' => 'missing-auth'],
        ['case' => 'replay', 'kind' => 'replay'],
    ];
    $results = [];
    $passed = true;
    foreach ($suite as $test) {
        if ($test['kind'] === 'missing-auth') {
            $result = requestProbe($probeOrigin, PROBE_PATH, (string)time(), '', null);
            $results[] = ['case' => $test['case'], 'results' => [$result]];
            $passed = $passed && $result['http_status'] === 401;
            continue;
        }
        $result = signedRequest($probeOrigin, PROBE_PATH, $secret, $test['kind']);
        $results[] = ['case' => $test['case'], 'results' => $result['results']];
        $passed = $passed && $result['passed'];
    }
    unset($secret);
    emitResult($case, $results, $passed ? 0 : 1);
}

if ($case === 'overlap' || $case === 'delay-suite') {
    $requests = $case === 'overlap'
        ? [
            ['case' => 'delay-30-a', 'path' => '/probe/delay/30'],
            ['case' => 'delay-30-b', 'path' => '/probe/delay/30'],
        ]
        : array_map(
            static fn (int $seconds): array => ['case' => 'delay-' . $seconds, 'path' => '/probe/delay/' . $seconds],
            [5, 30, 60, 90, 120]
        );
    $concurrent = concurrentRequests($probeOrigin, $requests, $secret);
    if (!$concurrent['available']) {
        unset($secret);
        emitResult($case, [['error' => 'curl_multi_unavailable']], 2);
    }
    $passed = count($concurrent['results']) === count($requests);
    foreach ($concurrent['results'] as $result) {
        $passed = $passed && $result['http_status'] === 200;
    }
    unset($secret);
    emitResult($case, $concurrent['results'], $passed ? 0 : 1);
}

$kind = match ($case) {
    'invalid-signature' => 'invalid',
    'stale-timestamp' => 'stale',
    'replay' => 'replay',
    default => 'valid',
};
$path = str_starts_with($case, 'delay-')
    ? '/probe/delay/' . substr($case, strlen('delay-'))
    : PROBE_PATH;
$result = signedRequest($probeOrigin, $path, $secret, $kind);
unset($secret);
emitResult($case, $result['results'], $result['passed'] ? 0 : 1);
