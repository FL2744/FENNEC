<?php
// Rename to fennec-memory-config.php after editing. No API keys belong here.
return [
    'allowed_origin' => 'https://l1001.vt.domains',
    // Use the actual home path shown in cPanel File Manager, not this placeholder.
    // Create this folder yourself OUTSIDE public_html and all other website roots.
    'storage_dir' => '/home/YOUR_CPANEL_USERNAME/fennec-private',
    'public_roots' => ['/home/YOUR_CPANEL_USERNAME/public_html'],
    'vault_limit_bytes' => 16 * 1024 * 1024,
    'total_limit_bytes' => 128 * 1024 * 1024,
];
