<?php
/** FENNEC encrypted memory store. PHP 8.1+ with PDO_SQLite. No provider API calls. */
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
function reply(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}
function valid_hex($value): bool { return is_string($value) && preg_match('/\A[a-f0-9]{64}\z/D', $value) === 1; }
function is_within(string $path, string $root): bool { return $path === $root || strpos($path, $root . DIRECTORY_SEPARATOR) === 0; }
try {
    $configFile = __DIR__ . '/fennec-memory-config.php';
    if (!is_file($configFile)) reply(503, ['error' => 'Memory setup is incomplete: install fennec-memory-config.php.']);
    $config = require $configFile;
    if (!is_array($config)) reply(503, ['error' => 'Memory configuration is invalid.']);
    $origin = $config['allowed_origin'] ?? '';
    if (!is_string($origin) || !preg_match('~\Ahttps://[a-zA-Z0-9.-]+(?::[0-9]+)?\z~D', $origin)) reply(503, ['error' => 'Configure the HTTPS website origin for memory.']);
    if (empty($_SERVER['HTTPS']) || strtolower((string)$_SERVER['HTTPS']) === 'off') reply(400, ['error' => 'Memory requires HTTPS.']);
    if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $origin) reply(403, ['error' => 'Origin not allowed.']);
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') reply(403, ['error' => 'Cross-site memory requests are not allowed.']);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($method, ['GET', 'POST'], true)) { header('Allow: GET, POST'); reply(405, ['error' => 'Method not allowed.']); }
    $id = $_GET['id'] ?? null; $provider = $_GET['provider'] ?? null;
    if (!valid_hex($id) || !in_array($provider, ['openai', 'arc'], true)) reply(401, ['error' => 'Memory identifier or provider is invalid. Reload the updated FENNEC page.']);
    // CGI/FastCGI hosts may remove Authorization before PHP sees it. A dedicated
    // header carries the SAME derived storage secret, never the original API key.
    $customToken = $_SERVER['HTTP_X_FENNEC_MEMORY_TOKEN'] ?? null;
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if ($customToken === null && strcasecmp($name, 'X-Fennec-Memory-Token') === 0) $customToken = $value;
            if ($auth === '' && strcasecmp($name, 'Authorization') === 0) $auth = $value;
        }
    }
    if ($customToken !== null) {
        if (!valid_hex($customToken)) reply(401, ['error' => 'Memory access token is invalid. Reload the updated FENNEC page.']);
        $token = $customToken;
    } elseif (is_string($auth) && preg_match('/\ABearer ([a-f0-9]{64})\z/D', $auth, $match)) {
        $token = $match[1]; // Compatibility with the original client.
    } else {
        reply(401, ['error' => 'Memory access token did not reach PHP. Upload both the updated HTML and PHP files, then reload.']);
    }
    // The identifier alone is insufficient: an independent derived bearer secret
    // is required to locate a vault. Neither secret is the encryption key.
    $vault = hash('sha256', "fennec-storage-v1|$provider|$id|" . $token);
    unset($auth, $match, $customToken, $token);
    $before = $_GET['before'] ?? null;
    if ($before !== null && (!is_string($before) || !preg_match('/\A[1-9][0-9]{0,14}\z/D', $before))) reply(400, ['error' => 'Invalid history cursor.']);
    $envelope = null;
    if ($method === 'POST') {
        if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') reply(415, ['error' => 'JSON is required.']);
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 400000) reply(413, ['error' => 'Encrypted conversation is too large.']);
        $raw = file_get_contents('php://input', false, null, 0, 400001);
        if ($raw === false || strlen($raw) > 400000) reply(413, ['error' => 'Encrypted conversation is too large.']);
        try { $body = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); } catch (JsonException $e) { reply(400, ['error' => 'Invalid JSON.']); }
        $envelope = is_array($body) ? ($body['envelope'] ?? null) : null;
        if (!is_array($envelope) || count($envelope) !== 4 || ($envelope['v'] ?? null) !== 1 || !is_string($envelope['id'] ?? null) || !preg_match('/\A[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/D', $envelope['id'])) reply(400, ['error' => 'Invalid encrypted envelope.']);
        foreach (['iv', 'ciphertext'] as $field) if (!is_string($envelope[$field] ?? null)) reply(400, ['error' => 'Invalid encrypted envelope.']);
        $iv = base64_decode($envelope['iv'], true); $ciphertext = base64_decode($envelope['ciphertext'], true);
        if ($iv === false || strlen($iv) !== 12 || base64_encode($iv) !== $envelope['iv'] || $ciphertext === false || strlen($ciphertext) < 16 || strlen($ciphertext) > 240000 || base64_encode($ciphertext) !== $envelope['ciphertext']) reply(400, ['error' => 'Invalid encrypted data.']);
        $serialized = json_encode($envelope, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $bytes = strlen($serialized) + 1024;
    }
    // Refuse a storage directory within any web-accessible document root.
    // Configure all relevant roots if this cPanel account hosts multiple sites.
    $storage = realpath((string)($config['storage_dir'] ?? ''));
    $documentRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($storage === false || !is_dir($storage) || !is_writable($storage) || $documentRoot === false) reply(503, ['error' => 'Create and configure a private writable memory folder outside your website folders.']);
    $roots = array_merge([$documentRoot, __DIR__], $config['public_roots'] ?? []);
    foreach ($roots as $root) { $realRoot = realpath((string)$root); if ($realRoot !== false && is_within($storage, $realRoot)) reply(503, ['error' => 'The memory folder must be outside all public website folders.']); }
    if (!extension_loaded('pdo_sqlite')) reply(503, ['error' => 'Enable the PDO SQLite PHP extension in cPanel.']);
    umask(0077);
    $db = new PDO('sqlite:' . $storage . '/fennec-memory.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, vault TEXT NOT NULL, entry_id TEXT NOT NULL, envelope TEXT NOT NULL, bytes INTEGER NOT NULL, UNIQUE(vault, entry_id))');
    $db->exec('CREATE INDEX IF NOT EXISTS entries_vault_seq ON entries(vault, seq)');
    $db->exec('CREATE TABLE IF NOT EXISTS rates (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
    $db->exec('BEGIN IMMEDIATE');
    $now = time();
    $cleanup = $db->prepare('DELETE FROM rates WHERE expires < ?'); $cleanup->execute([$now]);
    $bucket = hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown')) . ':' . intdiv($now, 60);
    $rate = $db->prepare('SELECT count FROM rates WHERE bucket = ?'); $rate->execute([$bucket]);
    $count = (int)$rate->fetchColumn();
    if ($count >= 120) { $db->exec('ROLLBACK'); header('Retry-After: 60'); reply(429, ['error' => 'Too many memory requests. Retry in a minute.']); }
    $bump = $db->prepare('INSERT OR REPLACE INTO rates(bucket, count, expires) VALUES (?, ?, ?)'); $bump->execute([$bucket, $count + 1, $now + 120]);
    if ($method === 'GET') {
        $query = $db->prepare('SELECT seq, envelope FROM entries WHERE vault = ? AND seq < ? ORDER BY seq DESC LIMIT 51');
        $query->execute([$vault, $before === null ? PHP_INT_MAX : (int)$before]);
        $rows = $query->fetchAll(PDO::FETCH_ASSOC); $more = count($rows) > 50; $rows = array_slice($rows, 0, 50);
        $entries = array_map(static function(array $row): array { return ['seq' => (int)$row['seq'], 'envelope' => json_decode($row['envelope'], true, 16, JSON_THROW_ON_ERROR)]; }, $rows);
        $db->exec('COMMIT');
        reply(200, ['entries' => $entries, 'before' => $more ? (int)$rows[count($rows) - 1]['seq'] : null]);
    }
    // Append-only, idempotent writes preserve concurrent conversations from tabs/devices.
    $existing = $db->prepare('SELECT seq FROM entries WHERE vault = ? AND entry_id = ?'); $existing->execute([$vault, $envelope['id']]);
    $seq = $existing->fetchColumn();
    if ($seq !== false) { $db->exec('COMMIT'); reply(200, ['seq' => (int)$seq]); }
    $usage = $db->prepare('SELECT COALESCE(SUM(bytes), 0) FROM entries WHERE vault = ?'); $usage->execute([$vault]);
    $vaultBytes = (int)$usage->fetchColumn();
    $totalBytes = (int)$db->query('SELECT COALESCE(SUM(bytes), 0) FROM entries')->fetchColumn();
    $vaultLimit = max(1, (int)($config['vault_limit_bytes'] ?? 16777216));
    $totalLimit = max(1, (int)($config['total_limit_bytes'] ?? 134217728));
    if ($vaultBytes + $bytes > $vaultLimit || $totalBytes + $bytes > $totalLimit) { $db->exec('COMMIT'); reply(507, ['error' => 'Memory storage is full. Contact the site administrator; previous conversations are preserved.']); }
    $insert = $db->prepare('INSERT INTO entries(vault, entry_id, envelope, bytes) VALUES (?, ?, ?, ?)');
    $insert->execute([$vault, $envelope['id'], $serialized, $bytes]); $seq = (int)$db->lastInsertId();
    $db->exec('COMMIT'); reply(201, ['seq' => $seq]);
} catch (Throwable $e) {
    if (isset($db)) { try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) {} }
    // Never log request bodies, Authorization headers, or private conversation material.
    reply(503, ['error' => 'Memory service is unavailable. Check the private folder permissions, PHP version, and SQLite support.']);
}
