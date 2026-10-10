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
const OBSERVATION_SCHEMA_VERSION = 2;
const MAX_OBSERVATION_BYTES = 32768;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

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

function newUuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4)
        . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}

function validUtcTimestamp(mixed $value): bool
{
    if (!is_string($value) || strlen($value) > 40) {
        return false;
    }
    try {
        $date = new DateTimeImmutable($value);
        return $date->getOffset() === 0 && $date->format('c') === $value;
    } catch (Throwable) {
        return false;
    }
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
        || is_link(OBSERVATION_FILE) || !validObservationRecord($record)) {
        return false;
    }
    $temporary = OBSERVATION_FILE . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $previousUmask = umask(0077);
    $handle = @fopen($temporary, 'x');
    umask($previousUmask);
    if ($handle === false) {
        return false;
    }
    $ok = false;
    try {
        @chmod($temporary, 0600);
        $json = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . PHP_EOL;
        if (strlen($json) > MAX_OBSERVATION_BYTES) {
            throw new RuntimeException('observation_too_large');
        }
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
    $size = @filesize(OBSERVATION_FILE);
    if (!is_int($permissions) || (($permissions & 0077) !== 0)
        || !is_int($size) || $size < 2 || $size > MAX_OBSERVATION_BYTES) {
        return null;
    }
    try {
        $record = json_decode((string)file_get_contents(OBSERVATION_FILE), true, 16, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return null;
    }
    return is_array($record) && validObservationRecord($record) ? $record : null;
}

function validCounterSnapshot(mixed $snapshot, bool $allowZero): bool
{
    return is_array($snapshot)
        && validUuid($snapshot['instanceId'] ?? null)
        && validUtcTimestamp($snapshot['capturedAt'] ?? null)
        && is_int($snapshot['activeCount'] ?? null)
        && $snapshot['activeCount'] >= ($allowZero ? 0 : 1)
        && $snapshot['activeCount'] <= MAX_PROBE_ACTIVE
        && is_int($snapshot['maxObservedActive'] ?? null)
        && $snapshot['maxObservedActive'] >= $snapshot['activeCount']
        && $snapshot['maxObservedActive'] <= MAX_PROBE_ACTIVE;
}

function validDelayResult(mixed $delayResult): bool
{
    $allowedKeys = [
        'callerDeadlineReached', 'capturedAt', 'disposition', 'duration_ms', 'http_status',
        'observation', 'redirect_diagnostic', 'response_error', 'transport_error',
    ];
    if (!is_array($delayResult) || !validUtcTimestamp($delayResult['capturedAt'] ?? null)
        || array_diff(array_keys($delayResult), $allowedKeys) !== []
        || array_diff(['callerDeadlineReached', 'capturedAt', 'disposition', 'duration_ms', 'http_status',
            'observation', 'response_error', 'transport_error'], array_keys($delayResult)) !== []
        || !(is_int($delayResult['http_status'] ?? null)
            && $delayResult['http_status'] >= 100 && $delayResult['http_status'] <= 599
            || ($delayResult['http_status'] ?? null) === null)
        || !(is_int($delayResult['duration_ms'] ?? null)
            && $delayResult['duration_ms'] >= 0 && $delayResult['duration_ms'] <= 120000)
        || !in_array($delayResult['transport_error'] ?? null, [null, 'network_error', 'timeout'], true)
        || !in_array($delayResult['response_error'] ?? null,
            [null, 'invalid_response', 'unexpected_redirect', 'unexpected_http_status', 'timeout_or_incomplete'], true)
        || !in_array($delayResult['disposition'] ?? null,
            ['delay_completed_normally', 'graceful_shutdown_indicated', 'redirect_ambiguous', 'transport_ambiguous',
                'timeout_ambiguous', 'invalid_or_unexpected_response', 'active_observation_missing',
                'evidence_mismatch', 'interruption_unproven'], true)) {
        return false;
    }
    if (!is_bool($delayResult['callerDeadlineReached'] ?? null)) {
        return false;
    }
    if (($delayResult['observation'] ?? null) !== null) {
        $observation = $delayResult['observation'];
        if (!is_array($observation)) {
            return false;
        }
        $observationKeys = array_keys($observation);
        sort($observationKeys);
        $completed = ($observation['status'] ?? null) === 'delay_completed'
            && ($observation['probeOnly'] ?? null) === true;
        $shutdown = ($observation['error'] ?? null) === 'probe_shutdown';
        $expectedObservationKeys = $completed
            ? ['durationMs', 'instanceId', 'maxObservedActive', 'probeOnly', 'requestId', 'status']
            : ['durationMs', 'error', 'instanceId', 'maxObservedActive', 'requestId'];
        if ((!$completed && !$shutdown) || $observationKeys !== $expectedObservationKeys
            || ($completed && ($delayResult['http_status'] ?? null) !== 200)
            || ($shutdown && ($delayResult['http_status'] ?? null) !== 503)
            || !validUuid($observation['requestId'] ?? null)
            || !validUuid($observation['instanceId'] ?? null)
            || !is_int($observation['durationMs'] ?? null) || $observation['durationMs'] < 0
            || !is_int($observation['maxObservedActive'] ?? null)
            || $observation['maxObservedActive'] < 1 || $observation['maxObservedActive'] > MAX_PROBE_ACTIVE) {
            return false;
        }
    }
    $diagnostic = $delayResult['redirect_diagnostic'] ?? null;
    $diagnosticKeys = is_array($diagnostic) ? array_keys($diagnostic) : [];
    sort($diagnosticKeys);
    if ($diagnostic !== null && (!is_array($diagnostic)
        || $diagnosticKeys !== ['hostClassification', 'locationPresent', 'portClassification', 'responderHint', 'routeKind', 'schemeKind', 'status']
        || !in_array($diagnostic['status'] ?? null, REDIRECT_STATUSES, true)
        || !is_bool($diagnostic['locationPresent'] ?? null)
        || !in_array($diagnostic['schemeKind'] ?? null, ['https', 'http', 'relative', 'invalid', 'absent'], true)
        || !in_array($diagnostic['hostClassification'] ?? null,
            ['approved_site_b', 'other', 'relative', 'unknown'], true)
        || !in_array($diagnostic['portClassification'] ?? null, ['approved_port', 'other', 'unknown'], true)
        || !in_array($diagnostic['routeKind'] ?? null,
            ['probe_delay', 'probe_status', 'wake_probe', 'health', 'other', 'unknown'], true)
        || !in_array($diagnostic['responderHint'] ?? null, ['intermediary_indicated', 'unknown'], true))) {
        return false;
    }
    if ($diagnostic !== null && (($delayResult['http_status'] ?? null) !== $diagnostic['status']
        || ($delayResult['response_error'] ?? null) !== 'unexpected_redirect')) {
        return false;
    }
    if (in_array($delayResult['http_status'] ?? null, REDIRECT_STATUSES, true) && $diagnostic === null) {
        return false;
    }
    return true;
}

function validObservationRecord(array $record): bool
{
    $allowedKeys = [
        'activeCount', 'activeObservation', 'capturedAt', 'delayResult', 'delaySeconds', 'instanceId',
        'maxObservedActive', 'phase', 'preRestartActiveCount', 'preRestartCapturedAt',
        'preRestartInstanceId', 'preRestartMaxObservedActive', 'runId', 'schemaVersion', 'postRestart',
    ];
    if (array_diff(array_keys($record), $allowedKeys) !== []
        || array_diff([
            'schemaVersion', 'runId', 'phase', 'capturedAt', 'preRestartCapturedAt', 'preRestartInstanceId',
            'preRestartActiveCount', 'preRestartMaxObservedActive', 'activeObservation', 'instanceId',
            'activeCount', 'maxObservedActive', 'delaySeconds', 'delayResult',
        ], array_keys($record)) !== []) {
        return false;
    }
    if (($record['schemaVersion'] ?? null) !== OBSERVATION_SCHEMA_VERSION
        || !validUuid($record['runId'] ?? null)
        || !validUuid($record['preRestartInstanceId'] ?? null)
        || !validUtcTimestamp($record['preRestartCapturedAt'] ?? null)
        || ($record['preRestartActiveCount'] ?? null) !== 0
        || !is_int($record['preRestartMaxObservedActive'] ?? null)
        || $record['preRestartMaxObservedActive'] < 0
        || $record['preRestartMaxObservedActive'] > MAX_PROBE_ACTIVE
        || ($record['delaySeconds'] ?? null) !== 30
        || !in_array($record['phase'] ?? null, ['pre_restart', 'active_confirmed', 'delay_result', 'active_not_confirmed'], true)
        || !validUtcTimestamp($record['capturedAt'] ?? null)) {
        return false;
    }
    $active = $record['activeObservation'] ?? null;
    if ($active !== null && (!is_array($active)
        || array_diff(array_keys($active), ['activeCount', 'capturedAt', 'instanceId', 'maxObservedActive']) !== []
        || count($active) !== 4 || !validCounterSnapshot($active, false)
        || $active['instanceId'] !== $record['preRestartInstanceId'])) {
        return false;
    }
    if (in_array($record['phase'], ['pre_restart', 'active_not_confirmed'], true) && $active !== null) {
        return false;
    }
    if ($record['phase'] === 'active_confirmed' && $active === null) {
        return false;
    }
    if (array_key_exists('delayResult', $record) && $record['delayResult'] !== null
        && !validDelayResult($record['delayResult'])) {
        return false;
    }
    if (in_array($record['phase'], ['delay_result', 'active_not_confirmed'], true)
        && !is_array($record['delayResult'] ?? null)) {
        return false;
    }
    if (is_array($active) && strtotime($active['capturedAt']) < strtotime($record['preRestartCapturedAt'])) {
        return false;
    }
    if (is_array($record['delayResult'] ?? null)
        && strtotime($record['delayResult']['capturedAt']) < strtotime($active['capturedAt'] ?? $record['preRestartCapturedAt'])) {
        return false;
    }
    if (is_array($record['delayResult'] ?? null)
        && delayDisposition($record['delayResult'], is_array($active) ? $active : null)
            !== $record['delayResult']['disposition']) {
        return false;
    }
    $expectedInstance = is_array($active) ? $active['instanceId']
        : ($record['phase'] === 'active_not_confirmed' ? null : $record['preRestartInstanceId']);
    $expectedActiveCount = is_array($active) ? $active['activeCount']
        : ($record['phase'] === 'active_not_confirmed' ? null : 0);
    $expectedMaximum = is_array($active) ? $active['maxObservedActive']
        : ($record['phase'] === 'active_not_confirmed' ? null : $record['preRestartMaxObservedActive']);
    if (($record['instanceId'] ?? null) !== $expectedInstance
        || ($record['activeCount'] ?? null) !== $expectedActiveCount
        || ($record['maxObservedActive'] ?? null) !== $expectedMaximum) {
        return false;
    }
    if (array_key_exists('postRestart', $record)) {
        $post = $record['postRestart'];
        $postKeys = [
            'activeCount', 'assessment', 'capturedAt', 'durationMs', 'httpStatus', 'interruptionAssessment',
            'maxObservedActive', 'postRestartInstanceId', 'postStatusValid', 'processIdChanged',
            'responseError', 'transportError',
        ];
        if (!is_array($post) || !validUtcTimestamp($post['capturedAt'] ?? null)
            || array_diff(array_keys($post), $postKeys) !== [] || array_diff($postKeys, array_keys($post)) !== []
            || !is_bool($post['postStatusValid'] ?? null)
            || !in_array($post['assessment'] ?? null,
                ['process_replacement_observed', 'process_replacement_not_observed', 'post_status_unavailable',
                    'interruption_unproven'], true)
            || !in_array($post['interruptionAssessment'] ?? null,
                ['interruption_unproven', 'delay_completed_normally', 'graceful_shutdown_requires_owner_review'], true)
            || !(is_bool($post['processIdChanged'] ?? null) || ($post['processIdChanged'] ?? null) === null)
            || !(validUuid($post['postRestartInstanceId'] ?? null) || ($post['postRestartInstanceId'] ?? null) === null)
            || ($post['postStatusValid'] !== validUuid($post['postRestartInstanceId'] ?? null))
            || ($post['processIdChanged'] !== null && $post['processIdChanged']
                !== (($post['postRestartInstanceId'] ?? null) !== $record['preRestartInstanceId']))
            || ($post['assessment'] === 'process_replacement_observed' && $post['processIdChanged'] !== true)
            || ($post['assessment'] === 'process_replacement_not_observed' && $post['processIdChanged'] !== false)
            || ($post['assessment'] === 'post_status_unavailable' && $post['postStatusValid'] !== false)
            || !(is_int($post['durationMs'] ?? null) && $post['durationMs'] >= 0 && $post['durationMs'] <= 120000)
            || !(is_int($post['httpStatus'] ?? null)
                && $post['httpStatus'] >= 100 && $post['httpStatus'] <= 599
                || ($post['httpStatus'] ?? null) === null)
            || !in_array($post['transportError'] ?? null, [null, 'network_error'], true)
            || !in_array($post['responseError'] ?? null, [null, 'invalid_response'], true)
            || ($post['postStatusValid'] && (!is_int($post['activeCount'] ?? null)
                || $post['activeCount'] < 0 || $post['activeCount'] > MAX_PROBE_ACTIVE
                || !is_int($post['maxObservedActive'] ?? null)
                || $post['maxObservedActive'] < $post['activeCount']
                || $post['maxObservedActive'] > MAX_PROBE_ACTIVE))) {
            return false;
        }
        if (!$post['postStatusValid']
            && (($post['activeCount'] ?? null) !== null || ($post['maxObservedActive'] ?? null) !== null)) {
            return false;
        }
        $expectedPostAssessment = !$post['postStatusValid'] ? 'post_status_unavailable'
            : ($post['processIdChanged'] === true ? 'process_replacement_observed' : 'process_replacement_not_observed');
        $expectedInterruption = postRestartAssessment($record, $post['postStatusValid'], $post['processIdChanged'])['interruptionAssessment'];
        if ($post['assessment'] !== $expectedPostAssessment
            || $post['interruptionAssessment'] !== $expectedInterruption) {
            return false;
        }
        if (strtotime($post['capturedAt']) < strtotime($record['delayResult']['capturedAt'] ?? $record['capturedAt'])) {
            return false;
        }
    }
    return true;
}

function validFreshPreRestartRecord(?array $record, ?int $now = null): bool
{
    if (!is_array($record) || ($record['phase'] ?? null) !== 'pre_restart'
        || !validObservationRecord($record)) {
        return false;
    }
    $capturedAt = strtotime($record['preRestartCapturedAt']);
    $age = ($now ?? time()) - $capturedAt;
    return $age >= 0 && $age <= 120;
}

function postRestartEvidenceAlreadyRecorded(array $record): bool
{
    return array_key_exists('postRestart', $record);
}

function delayDisposition(array $delayResult, ?array $active): string
{
    $observation = $delayResult['observation'] ?? null;
    if (($delayResult['response_error'] ?? null) === 'unexpected_redirect') {
        return 'redirect_ambiguous';
    }
    if (($delayResult['transport_error'] ?? null) === 'timeout'
        || ($delayResult['response_error'] ?? null) === 'timeout_or_incomplete') {
        return 'timeout_ambiguous';
    }
    if (($delayResult['transport_error'] ?? null) === 'network_error') {
        return 'transport_ambiguous';
    }
    if ($active === null) {
        return 'active_observation_missing';
    }
    if (is_array($observation) && $observation['instanceId'] !== $active['instanceId']) {
        return 'evidence_mismatch';
    }
    if (($delayResult['response_error'] ?? null) !== null || !is_array($observation)) {
        return 'invalid_or_unexpected_response';
    }
    if (($delayResult['http_status'] ?? null) === 200 && ($observation['status'] ?? null) === 'delay_completed') {
        return 'delay_completed_normally';
    }
    if (($delayResult['http_status'] ?? null) === 503 && ($observation['error'] ?? null) === 'probe_shutdown') {
        return 'graceful_shutdown_indicated';
    }
    return 'interruption_unproven';
}

function postRestartAssessment(array $record, bool $postStatusValid, ?bool $processIdChanged): array
{
    if (!$postStatusValid) {
        return [
            'assessment' => 'post_status_unavailable',
            'interruptionAssessment' => 'interruption_unproven',
        ];
    }
    if ($processIdChanged !== true) {
        return [
            'assessment' => 'process_replacement_not_observed',
            'interruptionAssessment' => 'interruption_unproven',
        ];
    }
    $delayResult = $record['delayResult'] ?? null;
    $delayObservation = is_array($delayResult) ? ($delayResult['observation'] ?? null) : null;
    if (is_array($delayResult) && ($delayResult['http_status'] ?? null) === 200
        && is_array($delayObservation) && ($delayObservation['status'] ?? null) === 'delay_completed') {
        return [
            'assessment' => 'process_replacement_observed',
            'interruptionAssessment' => 'delay_completed_normally',
        ];
    }
    if (is_array($delayResult) && ($delayResult['disposition'] ?? null) === 'graceful_shutdown_indicated') {
        return [
            'assessment' => 'process_replacement_observed',
            'interruptionAssessment' => 'graceful_shutdown_requires_owner_review',
        ];
    }
    return [
        'assessment' => 'process_replacement_observed',
        'interruptionAssessment' => 'interruption_unproven',
    ];
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

/** Classify a Location value without returning or persisting any part of its raw URL. */
function classifyRedirectLocation(string $location, string $approvedOrigin, string $requestPath): array
{
    $invalid = [
        'schemeKind' => 'invalid',
        'hostClassification' => 'unknown',
        'portClassification' => 'unknown',
        'routeKind' => 'unknown',
    ];
    if ($location === '' || strlen($location) > 2048
        || preg_match('/[\x00-\x20\x7f\\\\]/', $location) === 1) {
        return $invalid;
    }

    try {
        $parts = parse_url($location);
        $approved = parse_url($approvedOrigin);
    } catch (Throwable) {
        return $invalid;
    }
    if (!is_array($parts) || !is_array($approved)
        || !isset($approved['host']) || !is_string($approved['host'])) {
        return $invalid;
    }

    $absolute = preg_match('/^[a-z][a-z0-9+.-]*:/i', $location) === 1;
    $schemeRelative = str_starts_with($location, '//');
    $schemeKind = 'relative';
    $hostClassification = 'relative';
    $portClassification = 'relative';
    $targetPort = null;
    if ($absolute) {
        $scheme = strtolower((string)($parts['scheme'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true)) {
            return ['schemeKind' => 'other', 'hostClassification' => 'unknown', 'portClassification' => 'unknown', 'routeKind' => 'unknown'];
        }
        $schemeKind = $scheme;
    }
    if (isset($parts['user']) || isset($parts['pass'])) {
        return $invalid;
    }
    if ($absolute || $schemeRelative) {
        $host = $parts['host'] ?? null;
        if (!is_string($host) || $host === '' || str_contains($host, '%')) {
            return $invalid;
        }
        $hasOpeningBracket = str_starts_with($host, '[');
        $hasClosingBracket = str_ends_with($host, ']');
        if ($hasOpeningBracket !== $hasClosingBracket
            || (($hasOpeningBracket || $hasClosingBracket)
                && filter_var(substr($host, 1, -1), FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false)) {
            return $invalid;
        }
        $normalizedHost = strtolower(trim($host, '[]'));
        $isIp = filter_var($normalizedHost, FILTER_VALIDATE_IP) !== false;
        $isHostname = strlen($normalizedHost) <= 253
            && preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/iD', $normalizedHost) === 1;
        if (!$isIp && !$isHostname) {
            return $invalid;
        }
        $approvedHost = strtolower(trim((string)$approved['host'], '[]'));
        $targetPort = $parts['port'] ?? null;
        $approvedPort = $approved['port'] ?? 443;
        if ($targetPort !== null && (!is_int($targetPort) || $targetPort < 1 || $targetPort > 65535)) {
            return $invalid;
        }
        $effectiveTargetPort = $targetPort ?? ($schemeKind === 'http' ? 80 : 443);
        $effectiveApprovedPort = $approvedPort;
        if ($schemeRelative) {
            $schemeKind = 'relative';
            $effectiveTargetPort = $targetPort ?? $approvedPort;
        }
        $hostClassification = $normalizedHost === $approvedHost ? 'approved_site_b' : 'other_host';
        $portClassification = $effectiveTargetPort === $effectiveApprovedPort ? 'approved_port' : 'other_port';
    }

    $path = $parts['path'] ?? '';
    if (!is_string($path) || preg_match('/[\x00-\x20\x7f]/', $path) === 1) {
        return $invalid;
    }
    if ($path === '') {
        $path = $requestPath;
    } elseif ($path[0] !== '/') {
        $base = substr($requestPath, 0, (int)strrpos($requestPath, '/') + 1);
        $path = $base . $path;
    }
    if (str_contains($path, '%')) {
        return [
            'schemeKind' => $schemeKind,
            'hostClassification' => $hostClassification,
            'portClassification' => $portClassification,
            'routeKind' => 'unknown',
        ];
    }
    $segments = [];
    foreach (explode('/', $path) as $segment) {
        if ($segment === '' || $segment === '.') {
            continue;
        }
        if ($segment === '..') {
            if ($segments !== []) {
                array_pop($segments);
            }
            continue;
        }
        $segments[] = $segment;
    }
    $normalizedPath = '/' . implode('/', $segments);
    $routeKind = match (true) {
        preg_match('#^/probe/delay/(?:1|5|30)/?$#D', $normalizedPath) === 1 => 'probe_delay',
        preg_match('#^/probe/status/?$#D', $normalizedPath) === 1 => 'probe_status',
        preg_match('#^/api/internal/execution-wake/?$#D', $normalizedPath) === 1 => 'wake_probe',
        preg_match('#^/healthz/?$#D', $normalizedPath) === 1 => 'health',
        default => 'other',
    };

    return [
        'schemeKind' => $schemeKind,
        'hostClassification' => $hostClassification,
        'portClassification' => $portClassification,
        'routeKind' => $routeKind,
    ];
}

/** Track only response facts needed for a redirect diagnosis; never retain raw header values. */
function redirectHeaderCallback(array &$capture, string $line, string $approvedOrigin, string $requestPath): int
{
    $length = strlen($line);
    if (preg_match('/^HTTP\/\S+\s+(\d{3})(?:\s|$)/i', trim($line), $matches) === 1) {
        $capture['blocks'][] = [
            'status' => (int)$matches[1],
            'locationCount' => 0,
            'location' => null,
            'viaPresent' => false,
        ];
        $capture['current'] = array_key_last($capture['blocks']);
        return $length;
    }
    if ($line === "\r\n" || $line === "\n") {
        $capture['current'] = null;
        return $length;
    }
    $index = $capture['current'] ?? null;
    if (!is_int($index) || !isset($capture['blocks'][$index]) || !str_contains($line, ':')) {
        return $length;
    }
    [$name, $value] = explode(':', $line, 2);
    $name = strtolower(trim($name));
    if ($name === 'location') {
        $capture['blocks'][$index]['locationCount'] += 1;
        $capture['blocks'][$index]['location'] = classifyRedirectLocation(
            trim($value, " \t\r\n"),
            $approvedOrigin,
            $requestPath
        );
    } elseif ($name === 'via' && trim($value, " \t\r\n") !== '') {
        $capture['blocks'][$index]['viaPresent'] = true;
    }
    return $length;
}

function redirectDiagnostic(array $capture, int $status): array
{
    $block = null;
    foreach (array_reverse($capture['blocks'] ?? []) as $candidate) {
        if (($candidate['status'] ?? null) === $status) {
            $block = $candidate;
            break;
        }
    }
    $count = is_array($block) ? ($block['locationCount'] ?? 0) : 0;
    $location = is_array($block) ? ($block['location'] ?? null) : null;
    if ($count !== 1 || !is_array($location)) {
        $location = [
            'schemeKind' => $count === 0 ? 'absent' : 'invalid',
            'hostClassification' => 'unknown',
            'portClassification' => 'unknown',
            'routeKind' => 'unknown',
        ];
    }
    return [
        'status' => in_array($status, REDIRECT_STATUSES, true) ? $status : 0,
        'locationPresent' => $count > 0,
        ...$location,
        'responderHint' => is_array($block) && ($block['viaPresent'] ?? false)
            ? 'intermediary_indicated'
            : 'unknown',
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

if (defined('HOSTINGER_PROBE_CALLER_LIBRARY_ONLY') && HOSTINGER_PROBE_CALLER_LIBRARY_ONLY === true) {
    return;
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
    $capturedAt = gmdate('c');
    $saved = is_array($observation) && $observation['activeCount'] === 0 && writeObservationRecord([
        'schemaVersion' => OBSERVATION_SCHEMA_VERSION,
        'runId' => newUuid(),
        'phase' => 'pre_restart',
        'capturedAt' => $capturedAt,
        'preRestartCapturedAt' => $capturedAt,
        'preRestartInstanceId' => $observation['instanceId'],
        'preRestartActiveCount' => $observation['activeCount'],
        'preRestartMaxObservedActive' => $observation['maxObservedActive'],
        'activeObservation' => null,
        'instanceId' => $observation['instanceId'],
        'activeCount' => 0,
        'maxObservedActive' => $observation['maxObservedActive'],
        'delaySeconds' => 30,
        'delayResult' => null,
    ]);
    unset($secret);
    emitResult($case, [[...$result, 'observation_saved' => $saved]], $result['passed'] && $saved ? 0 : 1);
}

if ($case === 'restart-observe') {
    $previous = readObservationRecord();
    if (!validFreshPreRestartRecord($previous)) {
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
    $headerCapture = ['blocks' => [], 'current' => null];
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
        CURLOPT_HEADERFUNCTION => static function ($curlHandle, string $headerLine) use (&$headerCapture, $probeOrigin, $delayPath): int {
            return redirectHeaderCallback($headerCapture, $headerLine, $probeOrigin, $delayPath);
        },
    ]);
    curl_multi_add_handle($multi, $handle);
    unset($nonce, $signable, $signature);

    $activeObservation = null;
    $lastPollAt = 0;
    $observationSaved = false;
    $running = null;
    $deadline = hrtime(true) + 35_000_000_000;
    $deadlineExpired = false;
    do {
        $multiStatus = curl_multi_exec($multi, $running);
        if ($multiStatus !== CURLM_OK || hrtime(true) >= $deadline) {
            $deadlineExpired = $multiStatus === CURLM_OK && $running > 0;
            break;
        }
        $now = hrtime(true);
        if ($activeObservation === null && $now - $lastPollAt >= 500_000_000) {
            $lastPollAt = $now;
            $statusResult = signedRequest($probeOrigin, STATUS_PATH, $secret);
            $snapshot = $statusResult['results'][0]['observation'] ?? null;
            if (is_array($snapshot) && $snapshot['activeCount'] > 0
                && $snapshot['instanceId'] === $previous['preRestartInstanceId']) {
                $activeObservation = [
                    ...$snapshot,
                    'capturedAt' => gmdate('c'),
                ];
                $observationSaved = writeObservationRecord([
                    ...$previous,
                    'schemaVersion' => OBSERVATION_SCHEMA_VERSION,
                    'runId' => $previous['runId'],
                    'phase' => 'active_confirmed',
                    'capturedAt' => gmdate('c'),
                    'activeObservation' => $activeObservation,
                    'instanceId' => $activeObservation['instanceId'],
                    'activeCount' => $activeObservation['activeCount'],
                    'maxObservedActive' => $activeObservation['maxObservedActive'],
                    'delayResult' => null,
                ]);
            }
        }
        if ($running > 0) {
            curl_multi_select($multi, 0.25);
        }
    } while ($running > 0);

    $responseBody = curl_multi_getcontent($handle);
    $httpStatus = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_errno($handle);
    $transportError = $curlError === 0 ? null
        : ($curlError === CURLE_OPERATION_TIMEDOUT ? 'timeout' : 'network_error');
    $delayObservation = null;
    $responseError = null;
    $redirectDiagnostic = null;
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
    } elseif (in_array($httpStatus, REDIRECT_STATUSES, true)) {
        $redirectDiagnostic = redirectDiagnostic($headerCapture, $httpStatus);
        $responseError = 'unexpected_redirect';
    } elseif ($httpStatus > 0 && !in_array($httpStatus, [200, 503], true)) {
        $responseError = 'unexpected_http_status';
    } elseif ($deadlineExpired) {
        $responseError = 'timeout_or_incomplete';
    }
    $delayResult = [
        'capturedAt' => gmdate('c'),
        'http_status' => $httpStatus > 0 ? $httpStatus : null,
        'duration_ms' => (int)round(curl_getinfo($handle, CURLINFO_TOTAL_TIME) * 1000),
        'transport_error' => $transportError,
        'response_error' => $responseError,
        'observation' => $delayObservation,
        'callerDeadlineReached' => $deadlineExpired,
        ...($redirectDiagnostic === null ? [] : ['redirect_diagnostic' => $redirectDiagnostic]),
    ];
    $delayResult['disposition'] = delayDisposition($delayResult, $activeObservation);
    $record = [
        ...$previous,
        'schemaVersion' => OBSERVATION_SCHEMA_VERSION,
        'runId' => $previous['runId'],
        'phase' => $activeObservation === null ? 'active_not_confirmed' : 'delay_result',
        'capturedAt' => gmdate('c'),
        'instanceId' => $activeObservation['instanceId'] ?? null,
        'activeCount' => $activeObservation['activeCount'] ?? null,
        'maxObservedActive' => $activeObservation['maxObservedActive'] ?? null,
        'activeObservation' => $activeObservation,
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
    $previous = readObservationRecord();
    if (!is_array($previous)) {
        unset($secret);
        emitResult($case, [[
            'postStatusValid' => false,
            'processIdChanged' => null,
            'assessment' => 'post_status_unavailable',
            'interruptionAssessment' => 'interruption_unproven',
            'evidenceSaved' => false,
            'evidenceError' => 'observation_missing_or_invalid',
        ]], 1);
    }
    if (postRestartEvidenceAlreadyRecorded($previous)) {
        unset($secret);
        emitResult($case, [[
            'postStatusValid' => (bool)$previous['postRestart']['postStatusValid'],
            'processIdChanged' => $previous['postRestart']['processIdChanged'],
            'assessment' => $previous['postRestart']['assessment'],
            'interruptionAssessment' => $previous['postRestart']['interruptionAssessment'],
            'evidenceSaved' => true,
            'evidenceError' => 'post_status_already_recorded',
        ]], 1);
    }

    $result = signedRequest($probeOrigin, STATUS_PATH, $secret);
    $statusResult = $result['results'][0] ?? [];
    $observation = $statusResult['observation'] ?? null;
    $postStatusValid = is_array($observation);
    $processIdChanged = $postStatusValid
        ? $observation['instanceId'] !== $previous['preRestartInstanceId']
        : null;
    $assessmentResult = postRestartAssessment($previous, $postStatusValid, $processIdChanged);
    $assessment = $assessmentResult['assessment'];
    $interruptionAssessment = $assessmentResult['interruptionAssessment'];
    $postRestart = [
        'capturedAt' => gmdate('c'),
        'postStatusValid' => $postStatusValid,
        'httpStatus' => $statusResult['http_status'] ?? null,
        'durationMs' => $statusResult['duration_ms'] ?? 0,
        'transportError' => $statusResult['transport_error'] ?? null,
        'responseError' => $statusResult['response_error'] ?? null,
        'postRestartInstanceId' => $postStatusValid ? $observation['instanceId'] : null,
        'activeCount' => $postStatusValid ? $observation['activeCount'] : null,
        'maxObservedActive' => $postStatusValid ? $observation['maxObservedActive'] : null,
        'processIdChanged' => $processIdChanged,
        'assessment' => $assessment,
        'interruptionAssessment' => $interruptionAssessment,
    ];
    $record = [...$previous, 'postRestart' => $postRestart];
    $saved = writeObservationRecord($record);
    unset($secret);
    emitResult($case, [[
        'postStatusValid' => $postStatusValid,
        'postStatus' => [
            'http_status' => $statusResult['http_status'] ?? null,
            'duration_ms' => $statusResult['duration_ms'] ?? 0,
            'transport_error' => $statusResult['transport_error'] ?? null,
            'response_error' => $statusResult['response_error'] ?? null,
            'observation' => $observation,
        ],
        'preRestartInstanceId' => $previous['preRestartInstanceId'],
        'processIdChanged' => $processIdChanged,
        'assessment' => $assessment,
        'interruptionAssessment' => $interruptionAssessment,
        'evidenceSaved' => $saved,
    ]], $postStatusValid && $saved ? 0 : 1);
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
