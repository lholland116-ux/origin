<?php
declare(strict_types=1);

// Site A's PHP caller targets only the explicitly approved Site B temporary
// Hostinger hostname in this private allowlist file.
const SITE_A_HOST = 'darkblue-bear-768036.hostingersite.com';
const PROBE_HOST_FILE = __DIR__ . '/probe-host.allow';
const PROBE_KEY_FILE = __DIR__ . '/https-probe.key';
const PROBE_SKEW_SECONDS = 300;
const PROBE_PATH = '/api/internal/execution-wake';
const STATUS_PATH = '/probe/status';
const OBSERVATION_FILE = __DIR__ . '/probe-observation.json';
const MAX_PROBE_ACTIVE = 8;

function emitResult(string $case, array $results, int $exitCode): never
{
    echo json_encode(
        ['component' => 'hostinger_probe_caller', 'case' => $case, 'results' => $results],
        JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . PHP_EOL;
    exit($exitCode);
}

function validUuid(mixed $value): bool
{
    return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iD', $value) === 1;
}

/** Return only the explicitly approved observation fields. */
function validatedObservation(string $path, int $status, mixed $decoded): ?array
{
    if (!is_array($decoded)) {
        return null;
    }
    if ($path === STATUS_PATH) {
        if ($status !== 200) {
            return null;
        }
        $keys = array_keys($decoded);
        sort($keys);
        if ($keys !== ['activeCount', 'instanceId', 'maxObservedActive']
            || !validUuid($decoded['instanceId'] ?? null)
            || !is_int($decoded['activeCount'] ?? null)
            || !is_int($decoded['maxObservedActive'] ?? null)
            || $decoded['activeCount'] < 0 || $decoded['activeCount'] > MAX_PROBE_ACTIVE
            || $decoded['maxObservedActive'] < $decoded['activeCount']
            || $decoded['maxObservedActive'] > MAX_PROBE_ACTIVE) {
            return null;
        }
        return [
            'instanceId' => $decoded['instanceId'],
            'activeCount' => $decoded['activeCount'],
            'maxObservedActive' => $decoded['maxObservedActive'],
        ];
    }
    if (preg_match('#^/probe/delay/(5|30)$#D', $path) === 1) {
        if (!in_array($status, [200, 503], true)) {
            return null;
        }
        $keys = array_keys($decoded);
        sort($keys);
        $completed = $status === 200 && ($decoded['status'] ?? null) === 'delay_completed';
        $interrupted = $status === 503 && ($decoded['error'] ?? null) === 'probe_shutdown';
        $expectedKeys = $completed
            ? ['durationMs', 'instanceId', 'maxObservedActive', 'probeOnly', 'requestId', 'status']
            : ['durationMs', 'error', 'instanceId', 'maxObservedActive', 'requestId'];
        if (!$completed && !$interrupted) {
            return null;
        }
        if ($keys !== $expectedKeys
            || ($completed && ($decoded['probeOnly'] ?? null) !== true)
            || !validUuid($decoded['instanceId'] ?? null)
            || !validUuid($decoded['requestId'] ?? null)
            || !is_int($decoded['durationMs'] ?? null) || $decoded['durationMs'] < 0
            || !is_int($decoded['maxObservedActive'] ?? null)
            || $decoded['maxObservedActive'] < 1 || $decoded['maxObservedActive'] > MAX_PROBE_ACTIVE) {
            return null;
        }
        return [
            ...($completed ? ['status' => 'delay_completed', 'probeOnly' => true] : ['error' => 'probe_shutdown']),
            'requestId' => $decoded['requestId'],
            'instanceId' => $decoded['instanceId'],
            'durationMs' => $decoded['durationMs'],
            'maxObservedActive' => $decoded['maxObservedActive'],
        ];
    }
    if ($status === 200 && $path === PROBE_PATH && ($decoded['status'] ?? null) === 'accepted'
        && ($decoded['probeOnly'] ?? null) === true) {
        return ['status' => 'accepted', 'probeOnly' => true];
    }
    return null;
}

function writeObservationRecord(array $record): bool
{
    $directory = realpath(__DIR__);
    if (!is_string($directory) || preg_match('#(?:^|/)public_html(?:/|$)#i', $directory) === 1
        || is_link(OBSERVATION_FILE)) {
        return false;
    }
    $temporary = OBSERVATION_FILE . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $handle = @fopen($temporary, 'x');
    if ($handle === false) {
        return false;
    }
    $ok = false;
    try {
        @chmod($temporary, 0600);
        $json = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . PHP_EOL;
        $written = fwrite($handle, $json);
        $ok = is_int($written) && $written === strlen($json) && fflush($handle);
    } catch (Throwable) {
        $ok = false;
    } finally {
        fclose($handle);
    }
    if (!$ok || !@chmod($temporary, 0600) || !@rename($temporary, OBSERVATION_FILE)) {
        @unlink($temporary);
        return false;
    }
    return true;
}

function readObservationRecord(): ?array
{
    if (is_link(OBSERVATION_FILE) || !is_file(OBSERVATION_FILE)) {
        return null;
    }
    $permissions = @fileperms(OBSERVATION_FILE);
    if (!is_int($permissions) || (($permissions & 0077) !== 0)) {
        return null;
    }
    try {
        $record = json_decode((string)file_get_contents(OBSERVATION_FILE), true, 16, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return null;
    }
    return is_array($record) ? $record : null;
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
    unset($context);

    $status = null;
    foreach ($responseHeaders as $header) {
        if (preg_match('/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/', $header, $matches) === 1) {
            $status = (int)$matches[1];
        }
    }
    $observation = null;
    $responseError = null;
    if (is_string($body) && ($status === 200 || (str_starts_with($path, '/probe/delay/') && $status === 503))) {
        try {
            $decoded = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
            $observation = validatedObservation($path, $status, $decoded);
            if ($observation === null) {
                $responseError = 'invalid_response';
            }
        } catch (Throwable) {
            $responseError = 'invalid_response';
        }
    }
    return [
        'http_status' => $status,
        'duration_ms' => (int)round((hrtime(true) - $started) / 1_000_000),
        'transport_error' => $body === false ? 'network_error' : null,
        'response_error' => $responseError,
        'observation' => $observation,
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
        if ($result['http_status'] !== $expected[$index]
            || $result['transport_error'] !== null
            || ($expected[$index] === 200 && $result['response_error'] !== null)) {
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
        $handles[] = ['case' => $request['case'], 'path' => $request['path'], 'handle' => $handle];
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
        $httpStatus = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $observation = null;
        $responseError = null;
        if (is_string($responseBody) && $httpStatus === 200) {
            try {
                $decoded = json_decode($responseBody, true, 16, JSON_THROW_ON_ERROR);
                $observation = validatedObservation($entry['path'], $httpStatus, $decoded);
                if ($observation === null) {
                    $responseError = 'invalid_response';
                }
            } catch (Throwable) {
                $responseError = 'invalid_response';
            }
        }
        $results[] = [
            'case' => $entry['case'],
            'http_status' => $httpStatus,
            'duration_ms' => (int)round((hrtime(true) - $startedAt[$index]) / 1_000_000),
            'transport_error' => curl_errno($handle) === 0 ? null : 'network_error',
            'response_error' => $responseError,
            'observation' => $observation,
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
    'overlap', 'delay-5', 'delay-30',
    'status', 'restart-pre', 'restart-post', 'restart-observe', 'cleanup',
];
if (!in_array($case, [...$singleCases, 'auth-suite'], true)) {
    emitResult('invalid-case', [], 2);
}
if ($case === 'cleanup') {
    $directory = realpath(__DIR__);
    if (!is_string($directory) || preg_match('#(?:^|/)public_html(?:/|$)#i', $directory) === 1) {
        emitResult($case, [['cleanup' => false, 'reason' => 'private_directory_required']], 2);
    }
    $cleaned = true;
    if (is_link(OBSERVATION_FILE)) {
        $cleaned = false;
    } elseif (is_file(OBSERVATION_FILE) && !@unlink(OBSERVATION_FILE)) {
        $cleaned = false;
    }
    foreach (glob(OBSERVATION_FILE . '.*.tmp') ?: [] as $temporaryFile) {
        if (is_file($temporaryFile) && !is_link($temporaryFile) && !@unlink($temporaryFile)) {
            $cleaned = false;
        }
    }
    emitResult($case, [['cleanup' => $cleaned]], $cleaned ? 0 : 1);
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

if ($case === 'overlap') {
    $requests = [
        ['case' => 'delay-5-a', 'path' => '/probe/delay/5'],
        ['case' => 'delay-5-b', 'path' => '/probe/delay/5'],
    ];
    $concurrent = concurrentRequests($probeOrigin, $requests, $secret);
    if (!$concurrent['available']) {
        unset($secret);
        emitResult($case, [['error' => 'curl_multi_unavailable']], 2);
    }
    $passed = count($concurrent['results']) === count($requests);
    foreach ($concurrent['results'] as $result) {
        $passed = $passed && $result['http_status'] === 200 && $result['response_error'] === null
            && is_array($result['observation']);
    }
    if ($passed) {
        $first = $concurrent['results'][0]['observation'];
        $second = $concurrent['results'][1]['observation'];
        $passed = $first['instanceId'] === $second['instanceId']
            && $first['maxObservedActive'] >= 2 && $second['maxObservedActive'] >= 2;
    }
    unset($secret);
    emitResult($case, $concurrent['results'], $passed ? 0 : 1);
}

if ($case === 'restart-pre') {
    $result = signedRequest($probeOrigin, STATUS_PATH, $secret);
    $observation = $result['results'][0]['observation'] ?? null;
    $saved = is_array($observation) && $observation['activeCount'] === 0 && writeObservationRecord([
        'phase' => 'pre_restart',
        'capturedAt' => gmdate('c'),
        'instanceId' => $observation['instanceId'],
        'activeCount' => $observation['activeCount'],
        'maxObservedActive' => $observation['maxObservedActive'],
    ]);
    unset($secret);
    emitResult($case, [[...$result, 'observation_saved' => $saved]], $result['passed'] && $saved ? 0 : 1);
}

if ($case === 'restart-observe') {
    $previous = readObservationRecord();
    if (!is_array($previous) || ($previous['phase'] ?? null) !== 'pre_restart'
        || !validUuid($previous['instanceId'] ?? null)) {
        unset($secret);
        emitResult($case, [['error' => 'missing_pre_restart_observation']], 2);
    }
    if (!function_exists('curl_multi_init')) {
        unset($secret);
        emitResult($case, [['error' => 'curl_multi_unavailable']], 2);
    }

    $delayPath = '/probe/delay/30';
    $timestamp = (string)time();
    $nonce = bin2hex(random_bytes(16));
    $signable = "v1\nPOST\n" . $delayPath . "\n" . $timestamp . "\n" . strtolower($nonce);
    $signature = hash_hmac('sha256', $signable, $secret);
    $multi = curl_multi_init();
    $handle = curl_init($probeOrigin . $delayPath);
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
        CURLOPT_TIMEOUT => 40,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    ]);
    curl_multi_add_handle($multi, $handle);
    unset($nonce, $signable, $signature);

    $activeObservation = null;
    $lastPollAt = 0;
    $observationSaved = false;
    $running = null;
    $deadline = hrtime(true) + 35_000_000_000;
    do {
        $multiStatus = curl_multi_exec($multi, $running);
        if ($multiStatus !== CURLM_OK || hrtime(true) >= $deadline) {
            break;
        }
        $now = hrtime(true);
        if ($activeObservation === null && $now - $lastPollAt >= 500_000_000) {
            $lastPollAt = $now;
            $statusResult = signedRequest($probeOrigin, STATUS_PATH, $secret);
            $snapshot = $statusResult['results'][0]['observation'] ?? null;
            if (is_array($snapshot) && $snapshot['activeCount'] > 0
                && $snapshot['instanceId'] === $previous['instanceId']) {
                $activeObservation = $snapshot;
                $observationSaved = writeObservationRecord([
                    'phase' => 'active_confirmed',
                    'capturedAt' => gmdate('c'),
                    'preRestartInstanceId' => $previous['instanceId'],
                    'instanceId' => $snapshot['instanceId'],
                    'activeCount' => $snapshot['activeCount'],
                    'maxObservedActive' => $snapshot['maxObservedActive'],
                    'delaySeconds' => 30,
                ]);
            }
        }
        if ($running > 0) {
            curl_multi_select($multi, 0.25);
        }
    } while ($running > 0);

    $responseBody = curl_multi_getcontent($handle);
    $httpStatus = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $transportError = curl_errno($handle) === 0 ? null : 'network_error';
    $delayObservation = null;
    $responseError = null;
    if (is_string($responseBody) && in_array($httpStatus, [200, 503], true)) {
        try {
            $decoded = json_decode($responseBody, true, 16, JSON_THROW_ON_ERROR);
            $delayObservation = validatedObservation($delayPath, $httpStatus, $decoded);
            if ($delayObservation === null) {
                $responseError = 'invalid_response';
            }
        } catch (Throwable) {
            $responseError = 'invalid_response';
        }
    }
    $delayResult = [
        'http_status' => $httpStatus > 0 ? $httpStatus : null,
        'duration_ms' => (int)round(curl_getinfo($handle, CURLINFO_TOTAL_TIME) * 1000),
        'transport_error' => $transportError,
        'response_error' => $responseError,
        'observation' => $delayObservation,
    ];
    $record = [
        'phase' => $activeObservation === null ? 'active_not_confirmed' : 'delay_result',
        'capturedAt' => gmdate('c'),
        'preRestartInstanceId' => $previous['instanceId'],
        'instanceId' => $activeObservation['instanceId'] ?? null,
        'activeCount' => $activeObservation['activeCount'] ?? null,
        'maxObservedActive' => $activeObservation['maxObservedActive'] ?? null,
        'delaySeconds' => 30,
        'delayResult' => $delayResult,
    ];
    $resultSaved = writeObservationRecord($record);
    curl_multi_remove_handle($multi, $handle);
    curl_close($handle);
    curl_multi_close($multi);
    unset($secret);
    $passed = $activeObservation !== null && $observationSaved && $resultSaved
        && $multiStatus === CURLM_OK && $httpStatus === 200 && $responseError === null;
    emitResult($case, [[
        'active_confirmed' => $activeObservation !== null,
        'observation_saved' => $observationSaved,
        'delay_result_saved' => $resultSaved,
        'delay_result' => $delayResult,
    ]], $passed ? 0 : 1);
}

if ($case === 'restart-post') {
    $result = signedRequest($probeOrigin, STATUS_PATH, $secret);
    $observation = $result['results'][0]['observation'] ?? null;
    $previous = readObservationRecord();
    $canCompare = is_array($observation) && is_array($previous)
        && in_array($previous['phase'] ?? null, ['active_confirmed', 'delay_result'], true)
        && is_int($previous['activeCount'] ?? null) && $previous['activeCount'] > 0
        && validUuid($previous['preRestartInstanceId'] ?? $previous['instanceId'] ?? null);
    $previousInstanceId = $canCompare
        ? ($previous['preRestartInstanceId'] ?? $previous['instanceId'])
        : null;
    $changed = $canCompare && $observation['instanceId'] !== $previousInstanceId;
    $saved = is_array($observation) && writeObservationRecord([
        'phase' => 'post_restart',
        'capturedAt' => gmdate('c'),
        'preRestartInstanceId' => $previousInstanceId,
        'postRestartInstanceId' => $observation['instanceId'],
        'processIdChanged' => $changed,
        'activeCount' => $observation['activeCount'],
        'maxObservedActive' => $observation['maxObservedActive'],
    ]);
    unset($secret);
    emitResult($case, [[
        ...$result,
        'previousInstanceId' => $previousInstanceId,
        'processIdChanged' => $changed,
        'observation_saved' => $saved,
    ]], $result['passed'] && $saved && $changed ? 0 : 1);
}

$kind = match ($case) {
    'invalid-signature' => 'invalid',
    'stale-timestamp' => 'stale',
    'replay' => 'replay',
    default => 'valid',
};
$path = str_starts_with($case, 'delay-')
    ? '/probe/delay/' . substr($case, strlen('delay-'))
    : (in_array($case, ['status', 'restart-pre', 'restart-post'], true) ? STATUS_PATH : PROBE_PATH);
$result = signedRequest($probeOrigin, $path, $secret, $kind);
unset($secret);
emitResult($case, $result['results'], $result['passed'] ? 0 : 1);
