const path = require('path');

// Ensure skiko WASM runtime files (kotlin/) are accessible via dev server
const kotlinDir = path.resolve(__dirname, 'kotlin');
config.devServer.static = [
    { directory: kotlinDir, publicPath: '/kotlin' },
    ...config.devServer.static
];
