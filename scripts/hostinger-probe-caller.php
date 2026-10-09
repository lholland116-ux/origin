<?php
declare(strict_types=1);

// Test-only caller for the isolated Hostinger Node probe. Never point this at
// lvtchat.com and never put the key, nonce, or signature in cron arguments.
const PROBE_ORIGIN = 'https://darkblue-bear-768036.hostingersite.com';
const PROBE_KEY_FILE = __DIR__ . '/https-probe.key';
const PROBE_SKEW_SECONDS = 300;

function emitResult(string $case, array $results, int $exitCode): never
{
    echo json_encode(
        ['component' => 'hostinger_probe_caller', 'case' => $case, 'results' => $results],
        JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . PHP_EOL;
    exit($exitCode);
}

function requestProbe(string $path, string $timestamp, string $nonce, ?string $signature): array
{
    $url = PROBE_ORIGIN . $path;
    $started = hrtime(true);
    $headers = [
        'Content-Length: 0',
        'Connection: close',
    ];
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

    $responseHeaders = [];
    $body = @file_get_contents($url, false, $context);
    if (isset($http_response_header) && is_array($http_response_header)) {
        $responseHeaders = $http_response_header;
    }
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

$case = $argv[1] ?? 'valid';
$cases = [
    'valid' => [
        'path' => '/api/internal/execution-wake', 'timestamp' => null,
        'signature' => 'valid', 'expected' => [200], 'copies' => 1,
    ],
    'invalid-signature' => [
        'path' => '/api/internal/execution-wake', 'timestamp' => null,
        'signature' => 'invalid', 'expected' => [401], 'copies' => 1,
    ],
    'stale-timestamp' => [
        'path' => '/api/internal/execution-wake', 'timestamp' => 'stale',
        'signature' => 'valid', 'expected' => [401], 'copies' => 1,
    ],
    'replay' => [
        'path' => '/api/internal/execution-wake', 'timestamp' => null,
        'signature' => 'valid', 'expected' => [200, 409], 'copies' => 2,
    ],
    'missing-key' => [
        'path' => '/api/internal/execution-wake', 'timestamp' => null,
        'signature' => 'none', 'expected' => [503], 'copies' => 1,
    ],
];
foreach ([1, 5, 30, 60, 90, 120] as $seconds) {
    $cases['delay-' . $seconds] = [
        'path' => '/probe/delay/' . $seconds, 'timestamp' => null,
        'signature' => 'valid', 'expected' => [200], 'copies' => 1,
    ];
}
if (!isset($cases[$case])) {
    emitResult('invalid-case', [], 2);
}
$probeOrigin = parse_url(PROBE_ORIGIN);
if (!is_array($probeOrigin) || ($probeOrigin['scheme'] ?? null) !== 'https'
    || ($probeOrigin['host'] ?? null) !== 'darkblue-bear-768036.hostingersite.com') {
    emitResult('unsafe-target', [], 2);
}
$secret = null;
if ($cases[$case]['signature'] !== 'none') {
    if (is_link(PROBE_KEY_FILE) || !is_file(PROBE_KEY_FILE)) {
        emitResult('key_unavailable', [], 2);
    }
    $permissions = @fileperms(PROBE_KEY_FILE);
    if (!is_int($permissions) || (($permissions & 0077) !== 0)) {
        emitResult('key_permissions_invalid', [], 2);
    }
    $secret = @file_get_contents(PROBE_KEY_FILE);
    if (!is_string($secret)) {
        emitResult('key_unavailable', [], 2);
    }
    $secret = rtrim($secret, "\r\n");
    if (strlen($secret) < 32) {
        emitResult('key_invalid', [], 2);
    }
}

$timestamp = $cases[$case]['timestamp'] === 'stale'
    ? (string)(time() - PROBE_SKEW_SECONDS - 1)
    : (string)time();
$nonce = bin2hex(random_bytes(16));
$signature = null;
if ($cases[$case]['signature'] !== 'none') {
    $signable = "v1\nPOST\n" . $cases[$case]['path'] . "\n" . $timestamp . "\n" . strtolower($nonce);
    $signature = hash_hmac('sha256', $signable, $secret);
    if ($cases[$case]['signature'] === 'invalid') {
        $signature = ($signature[0] === '0' ? '1' : '0') . substr($signature, 1);
    }
}
$results = [];
$successful = true;
for ($index = 0; $index < $cases[$case]['copies']; $index += 1) {
    $result = requestProbe($cases[$case]['path'], $timestamp, $nonce, $signature);
    $results[] = $result;
    if ($result['http_status'] !== $cases[$case]['expected'][$index]) {
        $successful = false;
    }
}
unset($secret, $nonce, $signature, $signable);
emitResult($case, $results, $successful ? 0 : 1);
