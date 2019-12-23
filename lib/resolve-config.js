const fs = require('fs-extra');

function resolveConfig(configPath) {
    const config = resolveConfigFile(configPath);
    for(const key in config) {
        if(process.env['CONF_' + key]) {
            if (typeof config[key] === 'number') {
                config[key] = Number(process.env['CONF_' + key]);
            } else if (typeof config[key] === 'boolean') {
                config[key] = Boolean(process.env['CONF_' + key]);
            } else if (config[key] instanceof Array) {
                config[key] = process.env['CONF_' + key].split(',');
            } else if (typeof config[key] === 'object') {
                config[key] = JSON.parse(process.env['CONF_' + key]);
            } else {
                config[key] = process.env['CONF_' + key];
            }
        }
    }
    return config;
}

function resolveConfigFile(configPath, skipMissing = false) {
    if (skipMissing && !fs.existsSync(configPath)) {
        return {};
    }
    let config = require(configPath);
    if (config.extends) {
        if(config.extends instanceof Array) {
            config.extends.forEach(extensionPath => {
                config = {...resolveConfig(extensionPath, true), ...config};
            });
        } else if(typeof config.extends === 'string') {
            config = {...resolveConfig(config.extends, true), ...config};
        } else {
            throw new Error("Unknown type for 'extends' config param");
        }
    }
    return config;
}

module.exports = resolveConfig;
