const fs = require('fs-extra');
const Tail = require('tail').Tail;
const needle = require("needle");
const child_process = require('child_process');
const path = require('path');
const request = require("request");
const deepmerge = require("deepmerge");
const ioClient = require("socket.io-client");
const util = require("util");
const yargs = require("yargs");
const version = require("./package").version;

// internal libraries
const objectOps = require("lib/objectOps");
const fileOps = require("lib/fileOps");
const pluginManager = require("lib/manager/pluginManager");
const hashFile = require('lib/hash').hashFile;
const factorio = require("lib/factorio");
const schema = require("lib/schema");
const link = require("lib/link");

// Uhm...
var global = {};

/**
 * Keeps track of the runtime parameters of an instance
 */
class Instance {
	constructor(dir, factorioDir, instanceConfig) {
		this._dir = dir;

		// This is expected to change with the config system rewrite
		this.config = {
			id: instanceConfig.id,
			name: instanceConfig.name,
			gamePort: instanceConfig.factorioPort,
			rconPort: instanceConfig.clientPort,
			rconPassword: instanceConfig.clientPassword,
		}

		let serverOptions = {
			gamePort: this.config.gamePort,
			rconPort: this.config.rconPort,
			rconPassword: this.config.rconPassword,
		};

		this.server = new factorio.FactorioServer(
			path.join(factorioDir, "data"), this._dir, serverOptions
		);
	}

	async init() {
		await this.server.init();
	}

	static async create(id, instanceDir, factorioDir, options) {
		let instanceConfig = {
			id,
			name: options.name,
			factorioPort:  null,
			clientPort:  null,
			clientPassword: null,
		}

		let instance = new this(instanceDir, factorioDir, instanceConfig);
		await instance.init();
		console.log(`Creating ${instance.path()}`);
		await fs.ensureDir(instance.path());
		await fs.ensureDir(instance.path("script-output"));

		await symlinkMods(instance, "sharedMods", console);
		console.log("Clusterio | Created instance with settings:")
		console.log(instanceConfig);

		// save instance config
		await fs.outputFile(instance.path("config.json"), JSON.stringify(instanceConfig, null, 4));

		let serverSettings = await factorio.FactorioServer.exampleSettings(path.join(factorioDir, "data"));
		let gameName = "Clusterio instance: " + instance.name;
		if (options.username) {
			gameName = options.username + "'s clusterio " + instance.name;
		}

		let overrides = {
			"name": gameName,
			"description": options.description,
			"tags": ["clusterio"],
			"visibility": options.visibility,
			"username": options.username,
			"token": options.token,
			"game_password": options.game_password,
			"require_user_verification": options.verify_user_identity,
			"allow_commands": options.allow_commands,
			"auto_pause": options.auto_pause,
		};

		for (let [key, value] of Object.entries(overrides)) {
			if (!Object.hasOwnProperty.call(serverSettings, key)) {
				throw Error(`Expected server settings to have a ${key} property`);
			}
			serverSettings[key] = value;
		}

		await fs.writeFile(instance.path("server-settings.json"), JSON.stringify(serverSettings, null, 4));

		return instance;
	}

	async createSave() {
		console.log("Creating save .....");

		await this.server.create("world");
		console.log("Clusterio | Successfully created save");
	}

	async start(slaveConfig, socket) {
		console.log("Deleting .tmp.zip files");
		let savefiles = fs.readdirSync(this.path("saves"));
		for(let i = 0; i < savefiles.length; i++){
			if(savefiles[i].substr(savefiles[i].length - 8, 8) == ".tmp.zip") {
				fs.unlinkSync(this.path("saves", savefiles[i]));
			}
		}
		console.log("Clusterio | Rotating old logs...");
		// clean old log file to avoid crash
		try{
			let logPath = this.path("factorio-current.log");
			let stat = await fs.stat(logPath);
			console.log(stat)
			console.log(stat.isFile())
			if(stat.isFile()){
				let logFilename = `factorio-${Math.floor(Date.parse(stat.mtime)/1000)}.log`;
				await fs.rename(logPath, this.path(logFilename));
				console.log(`Log rotated as ${logFilename}`);
			}
		}catch(e){}

		await symlinkMods(this, "sharedMods", console);

		// Spawn factorio server
		let latestSave = await fileOps.getNewestFile(this.path("saves"));
		if (latestSave === null) {
			throw new Error(
				"Your savefile seems to be missing. This might because you created an\n"+
				"instance without having factorio installed and configured properly.\n"+
				"Try installing factorio and adding your savefile to\n"+
				"instances/[instancename]/saves/"
			);
		}

		// Patch save with lua modules from plugins
		console.log("Clusterio | Patching save");

		// For now it's assumed that all files in the lua folder of a plugin is
		// to be patched in under the name of the plugin and loaded for all
		// plugins that are not disabled.  This will most likely change in the
		// future when the plugin refactor is done.
		let modules = [];
		for (let pluginName of await fs.readdir("sharedPlugins")) {
			let pluginDir = path.join("sharedPlugins", pluginName);
			if (await fs.pathExists(path.join(pluginDir, "DISABLED"))) {
				continue;
			}

			if (!await fs.pathExists(path.join(pluginDir, "lua"))) {
				continue;
			}

			let module = {
				"name": pluginName,
				"files": [],
			};

			for (let fileName of await fs.readdir(path.join(pluginDir, "lua"))) {
				module["files"].push({
					path: pluginName+"/"+fileName,
					content: await fs.readFile(path.join(pluginDir, "lua", fileName)),
					load: true,
				});
			}

			modules.push(module);
		}
		await factorio.patch(this.path("saves", latestSave), modules);

		this.server.on('rcon-ready', () => {
			console.log("Clusterio | RCON connection established");
			// Temporary measure for backwards compatibility
			let compatConfig = {
				id: this.config.id,
				unique: this.config.id,
				name: this.config.name,

				// FactorioServer.init may have generated a random port or password
				// if they were null.
				factorioPort: this.server.gamePort,
				clientPort: this.server.rconPort,
				clientPassword: this.server.rconPassword,
			}
			//instanceManagement(slaveConfig, this, compatConfig, this.server, socket); // XXX async function
		});

		await this.server.start(latestSave);
	}

	/**
	 * Stop the instance
	 */
	async stop() {
		// XXX this needs more thought to it
		if (this.server._state === "running") {
			await this.server.stop();
		}
	}

	/**
	 * Name of the instance
	 *
	 * This should not be used for filesystem paths.  See .path() for that.
	 */
	get name() {
		return this.config.name;
	}

	/**
	 * Return path in instance
	 *
	 * Creates a path using path.join with the given parts that's relative to
	 * the directory of the instance.  For example instance.path("mods")
	 * returns a path to the mods directory of the instance.  If no parts are
	 * given it returns a path to the directory of the instance.
	 */
	path(...parts) {
		return path.join(this._dir, ...parts);
	}
}

class SlaveConnector extends link.SocketIOClientConnector {
	constructor(slaveConfig) {
		super(slaveConfig.masterURL, slaveConfig.masterAuthToken);

		this.id = slaveConfig.id;
		this.name = slaveConfig.name;
	}

	register() {
		console.log("SOCKET | registering slave");
		this.send('register_slave', {
			agent: 'Clusterio Slave',
			version,
			id: this.id,
			name: this.name,
		});
	}
}

/**
 * Handles running the slave
 *
 * Connects to the master server over the socket.io connection and manages
 * intsances.
 */
class Slave extends link.Link {
	// I don't like God classes, but the alternative of putting all this state
	// into global variables is not much better.
	constructor(connector, slaveConfig) {
		super('slave', 'master', connector);
		link.attachAllMessages(this);
		this.config = {
			id: slaveConfig.id,
			name: slaveConfig.name,
			instancesDir: slaveConfig.instanceDirectory,
			factorioDir: slaveConfig.factorioDirectory,
			masterUrl: slaveConfig.masterURL,
			masterToken: slaveConfig.masterAuthToken,
			publicAddress: slaveConfig.publicIP,
		}

	}

	async _findNewInstanceDir(name) {
		try {
			checkFilename(name)
		} catch (err) {
			throw new Error(`Instance name ${err.message}`);
		}

		// For now add dashes until an unused directory name is found
		let dir = path.join(this.config.instancesDir, name);
		while (await fs.pathExists(dir)) {
			dir += '-';
		}

		return dir;
	}

	/**
	 * Looks up the instance for an instance request handler
	 *
	 * Called by the handler for InstanceRequest.
	 */
	async forwardInstanceRequest(handler, message) {
		let instance = this.instances.get(message.data.instance_id);
		if (!instance) {
			throw new errors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		return await handler.call(this, instance, message);
	}

	async createInstanceRequestHandler(message) {
		let { id, options } = message.data;
		if (this.instances.has(id)) {
			throw new Error(`Instance with ID ${id} already exists`);
		}

		let instanceDir = await this._findNewInstanceDir(options.name);
		// XXX: race condition on multiple simultanious calls
		let instance = await Instance.create(id, instanceDir, this.config.factorioDir, options);
		this.instances.set(id, instance);
		this.hookInstance(instance);
		this.updateInstances();
	}

	async createSaveInstanceRequestHandler(instance, message) {
		await instance.createSave();
	}

	async startInstanceInstanceRequestHandler(instance, message) {
		await instance.start(this.config, this.socket);
	}

	async stopInstanceInstanceRequestHandler(instance, message) {
		await instance.stop();
	}

	async deleteInstanceInstanceRequestHandler(instance, message) {
		await instance.stop();
		this.instances.delete(instance.config.id);

		await fs.remove(instance.path());
		this.updateInstances();
	}

	async sendRconInstanceRequestHandler(instance, message) {
		let result = await instance.server.sendRcon(message.data.command);
		return { result };
	}

	async findInstances() {
		let instances = new Map();
		for (let entry of await fs.readdir(this.config.instancesDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				let instanceConfig;
				let configPath = path.join(this.config.instancesDir, entry.name, "config.json");
				try {
					instanceConfig = JSON.parse(await fs.readFile(configPath));
				} catch (err) {
					if (err.code === "ENOENT") {
						continue; // Ignore folders without config.json
					}

					console.error(`Error occured while parsing ${configPath}: ${err}`);
				}

				// XXX should probably validate the entire config with a JSON Schema.
				if (typeof instanceConfig.id !== "number" || isNaN(instanceConfig.id)) {
					console.error(`${configPath} is missing id`);
					continue;
				}

				if (typeof instanceConfig.name !== "string") {
					console.error(`${configPath} is missing name`);
					continue;
				}

				let instancePath = path.join(this.config.instancesDir, entry.name);
				console.log(`found instance ${instanceConfig.name} in ${instancePath}`);
				let instance = new Instance(instancePath, this.config.factorioDir, instanceConfig);
				await instance.init();
				this.hookInstance(instance); // XXX this is the wrong place for this
				instances.set(instanceConfig.id, instance);
			}
		}

		return instances;
	}

	hookInstance(instance) {
		instance.server.on('output', (output) => {
			link.messages.instanceOutput.send(this, { instance_id: instance.config.id, output })
		});
	}


	updateInstances() {
		let list = [];
		for (let instance of this.instances.values()) {
			list.push({
				id: instance.config.id,
				name: instance.config.name,
			});
		}
		link.messages.updateInstances.send(this, { instances: list });
	}

	async start() {
		this.instances = await this.findInstances();
		await this.connect();
		this.updateInstances();
	}

	async stop() {
		for (let instance of this.instances.values()) {
			await instance.stop();
		}
	}
}

function checkFilename(name) {
	// All of these are bad in Windows only, except for /, . and ..
	// See: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
	const badChars = /[<>:"\/\\|?*\x00-\x1f]/g;
	const badEnd = /[. ]$/;

	const oneToNine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
	const badNames = [
		// Relative path components
		'.', '..',

		// Reserved filenames in Windows
		'CON', 'PRN', 'AUX', 'NUL',
		...oneToNine.map(n => `COM${n}`),
		...oneToNine.map(n => `LPT${n}`),
	];

	if (typeof name !== "string") {
		throw new Error("must be a string");
	}

	if (name === "") {
		throw new Error("cannot be empty");
	}

	if (badChars.test(name)) {
		throw new Error('cannot contain <>:"\\/|=* or control characters');
	}

	if (badNames.includes(name.toUpperCase())) {
		throw new Error(
			"cannot be named any of . .. CON PRN AUX NUL COM1-9 and LPT1-9"
		);
	}

	if (badEnd.test(name)) {
		throw new Error("cannot end with . or space");
	}
}

/**
 * Create and update symlinks for shared mods in an instance
 *
 * Creates symlinks for .zip and .dat files that are not present in the
 * instance mods directory but is present in the sharedMods directory,
 * and removes any symlinks that don't point to a file in the instance
 * mods directory.  If the instance mods directory doesn't exist it will
 * be created.
 *
 * Note that on Windows this creates hard links instead of symbolic
 * links as the latter requires elevated privileges.  This unfortunately
 * means the removal of mods from the shared mods dir can't be detected.
 *
 * @param {Instance} instance - Instance to link mods for
 * @param {string} sharedMods - Path to folder to link mods from.
 * @param {object} logger - console like logging interface.
 */
async function symlinkMods(instance, sharedMods, logger) {
	await fs.ensureDir(instance.path("mods"));

	// Remove broken symlinks in instance mods.
	for (let entry of await fs.readdir(instance.path("mods"), { withFileTypes: true })) {
		if (entry.isSymbolicLink()) {
			if (!await fs.pathExists(instance.path("mods", entry.name))) {
				logger.log(`Removing broken symlink ${entry.name}`);
				await fs.unlink(instance.path("mods", entry.name));
			}
		}
	}

	// Link entries that are in sharedMods but not in instance mods.
	let instanceModsEntries = new Set(await fs.readdir(instance.path("mods")));
	for (let entry of await fs.readdir(sharedMods, { withFileTypes: true })) {
		if (entry.isFile()) {
			if (['.zip', '.dat'].includes(path.extname(entry.name))) {
				if (!instanceModsEntries.has(entry.name)) {
					logger.log(`linking ${entry.name} from ${sharedMods}`);
					let target = path.join(sharedMods, entry.name);
					let link = instance.path("mods", entry.name);

					if (process.platform !== "win32") {
						await fs.symlink(path.relative(path.dirname(link), target), link);

					// On Windows symlinks require elevated privileges, which is
					// not something we want to have.  For this reason the mods
					// are hard linked instead.  This has the drawback of not
					// being able to identify when mods are removed from the
					// sharedMods directory, or which mods are linked.
					} else {
						await fs.link(target, link);
					}
				}

			} else {
				logger.warning(`Warning: ignoring file '${entry.name}' in sharedMods`);
			}

		} else {
			logger.warning(`Warning: ignoring non-file '${entry.name}' in sharedMods`);
		}
	}
}

async function startClient() {
	// add better stack traces on promise rejection
	process.on('unhandledRejection', r => console.log(r));

	// argument parsing
	const args = yargs
		.scriptName("client")
		.usage("$0 <command> [options]")
		.option('config', {
			nargs: 1,
			describe: "slave config file to use",
			default: 'config-slave.json',
			type: 'string',
		})
		.command('create-config', "Create slave config", (yargs) => {
			yargs.options({
				'name': { describe: "Name of the slave", nargs: 1, type: 'string', demandOption: true },
				'url': { describe: "Master URL", nargs: 1, type: 'string', default: "http://localhost:8080/" },
				'token': { describe: "Master token", nargs: 1, type: 'string', demandOption: true },
				'ip': { describe: "Public facing IP", nargs: 1, type: 'string', default: "localhost" },
				'instances-dir': { describe: "Instances directory", nargs: 1, type: 'string', default: "instances" },
				'factorio-dir': { describe: "Factorio directory", nargs: 1, type: 'string', default: "factorio" },
				'id': {
					describe: "Numeric id of the slave",
					nargs: 1,
					type: 'number',
					default: Math.random() * 2**31 | 0,
					defaultDescription: "random id",
				},
			});
		})
		.command('edit-config', "Edit slave config", (yargs) => {
			yargs.options({
				'name': { describe: "Set name of the slave", nargs: 1, type: 'string' },
				'url': { describe: "Set master URL", nargs: 1, type: 'string' },
				'token': { describe: "Set master token", nargs: 1, type: 'string' },
				'ip': { describe: "Set public facing IP", nargs: 1, type: 'string' },
				'instances-dir': { describe: "Set instances directory", nargs: 1, type: 'string' },
				'factorio-dir': { describe: "Set Factorio directory", nargs: 1, type: 'string' },
				'id': { describe: "Set id of the slave", nargs: 1, type: 'number' },
			});
		})
		.command('show-config', "Show slave config")
		.command('start', "Start slave")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	let command = args._[0];

	if (command === "create-config") {
		await fs.outputFile(args.config, JSON.stringify({
			name: args.name,
			masterURL: args.url,
			masterAuthToken: args.token,
			publicIP: args.ip,
			instanceDirectory: args.instancesDir,
			factorioDirectory: args.factorioDir,
			id: args.id,
		}, null, 4), { flag: 'wx' });
		return;

	} else if (command == "edit-config") {
		let slaveConfig = JSON.parse(await fs.readFile(args.config));
		if ('name' in args) slaveConfig.name = args.name;
		if ('url' in args) slaveConfig.masterURL = args.url;
		if ('token' in args) slaveConfig.masterAuthToken = args.token;
		if ('ip' in args) slaveConfig.publicIP = args.ip;
		if ('instancesDir' in args) slaveConfig.instanceDirectory = args.instancesDir;
		if ('factorioDir' in args) slaveConfig.factorioDirectory = args.factorioDir;
		if ('id' in args) slaveConfig.id = args.id;
		await fs.outputFile(args.config, JSON.stringify(slaveConfig, null, 4));
		return;

	} else if (command == "show-config") {
		let slaveConfig = JSON.parse(await fs.readFile(args.config));
		console.log(slaveConfig);
		return;
	}

	// If we get here the command was start

	// handle commandline parameters
	console.log(`Loading ${args.config}`);
	const slaveConfig = JSON.parse(await fs.readFile(args.config));

	await fs.ensureDir(slaveConfig.instanceDirectory);
	await fs.ensureDir("sharedPlugins");
	await fs.ensureDir("sharedMods");

	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioClient";

	// make sure we have the master access token
	if(!slaveConfig.masterAuthToken || typeof slaveConfig.masterAuthToken !== "string"){
		console.error("ERROR invalid config!");
		console.error(
			"Master server now needs an access token for write operations. As clusterio\n"+
			"slaves depends upon this, please add your token to config.json in the field\n"+
			"named masterAuthToken.  You can retrieve your auth token from the master in\n"+
			"secret-api-token.txt after running it once."
		);
		process.exitCode = 1;
		return;
	}

	// make sure url ends with /
	if (!slaveConfig.masterURL.endsWith("/")) {
		console.error("ERROR invalid config!");
		console.error("masterURL (set with --url) must end with '/'");
		process.exitCode = 1;
		return;
	}

	let slaveConnector = new SlaveConnector(slaveConfig);
	let slave = new Slave(slaveConnector, slaveConfig);

	// Handle interrupts
	let secondSigint = false
	process.on('SIGINT', () => {
		if (secondSigint) {
			console.log("Caught second interrupt, terminating immediately");
			process.exit(1);
		}

		secondSigint = true;
		console.log("Caught interrupt signal, shutting down");
		slave.stop().then(() => {
			// There's currently no shutdown mechanism for instance plugins so
			// they keep the event loop alive.
			process.exit();
		});
	});

	await slaveConnector.connect();
	await slave.start();

	/*
	} else if (command == "manage"){
		await manage(config, instance);
		// process.exit(0);
	*/
}

// ensure instancemanagement only ever runs once
var _instanceInitialized;
async function instanceManagement(slaveConfig, instance, instanceconfig, server, socket) {
	if (_instanceInitialized) return;
	_instanceInitialized = true;

	let compatUrl = slaveConfig.masterUrl;
	if (compatUrl.endsWith("/")) {
		compatUrl = compatUrl.slice(0, -1);
	}
	let compatConfig = {
		name: slaveConfig.name,
		masterURL: compatUrl,
		masterAuthToken: slaveConfig.masterToken,
		publicIP: slaveConfig.publicAddress,
		instanceDirectory: slaveConfig.instancesDir,
		factorioDirectory: slaveConfig.factorioDir,
	}

    console.log("Started instanceManagement();");

	// load plugins and execute onLoad event
	let pluginsToLoad = await pluginManager.getPlugins();
	let plugins = [];
	
	for(let i = 0; i < pluginsToLoad.length; i++){
		let pluginLoadStarted = Date.now();
		let combinedConfig = deepmerge(instanceconfig,compatConfig,{clone:true});
		combinedConfig.instanceName = instance.name;
		let pluginConfig = pluginsToLoad[i];
		
		if(!global.subscribedFiles) {
			global.subscribedFiles = {};
		}
		if (pluginConfig.enabled) {
			// require plugin class and execute it
			let pluginClass = require(path.resolve(pluginConfig.pluginPath, "index"));
			plugins[i] = new pluginClass(combinedConfig, async function(data, callback){
				if(data && data.toString('utf8')[0] != "/") {
                    console.log("Clusterio | "+ pluginsToLoad[i].name + " | " + data.toString('utf8'));
					return true;
				} else if (data && data.toString('utf8')[0] == "/"){
					let result = await server.sendRcon(data.toString('utf8'));
					if (typeof callback === "function") {
						callback(result);
					}
					return result;
				}
			}, { // extra functions to pass in object. Should have done it like this from the start, but won't break backwards compat.
				socket, // socket.io connection to master (and ES6 destructuring, yay)
			});
			if(plugins[i].factorioOutput && typeof plugins[i].factorioOutput === "function"){
				// when factorio logs a line, send it to the plugin. This includes things like autosaves, chat, errors etc
				server.on('stdout', data => plugins[i].factorioOutput(data.toString()));
			}
			if(pluginConfig.scriptOutputFileSubscription && typeof pluginConfig.scriptOutputFileSubscription == "string"){
				if(global.subscribedFiles[pluginConfig.scriptOutputFileSubscription]) {
					// please choose a unique file to subscribe to. If you need plugins to share this interface, set up a direct communication
					// between those plugins instead.
					throw "FATAL ERROR IN " + pluginConfig.name + " FILE ALREADY SUBSCRIBED " + pluginConfig.scriptOutputFileSubscription;
				}
				
				let outputPath = instance.path(
					"script-output",
					pluginConfig.scriptOutputFileSubscription
				);
				if (!fs.existsSync(outputPath)) {
					// Do something
					fs.writeFileSync(outputPath, "");
				}
				global.subscribedFiles[pluginConfig.scriptOutputFileSubscription] = true;
				console.log("Clusterio | Registered file subscription on "+outputPath);
				

				if(!pluginConfig.fileReadDelay || pluginConfig.fileReadDelay == 0) {
					// only wipe the file on restart for now, should most likely be rotated during runtime too
                    fs.writeFileSync(outputPath, "");
                    let tail = new Tail(outputPath);
                    tail.on("line", function (data) {
                        plugins[i].scriptOutput(data);
                    });
                } else {
                    fs.watch(outputPath, fileChangeHandler);
                    // run once in case a plugin wrote out information before the plugin loaded fully
                    // delay, so the socket got enough time to connect
                    setTimeout(() => {
                        fileChangeHandler(false, pluginConfig.scriptOutputFileSubscription);
                    }, 500);

                    // send file contents to plugin for processing
                    function fileChangeHandler(eventType, filename) {
                        if (filename != null) {
                            setTimeout(
                                () => {
                                    // get array of lines in file
                                    let stuff = fs.readFileSync(instance.path("script-output", filename), "utf8").split("\n");

                                    // if you found anything, reset the file
                                    if (stuff[0]) {
                                        fs.writeFileSync(instance.path("script-output", filename), "");
                                    }
                                    for (let o = 0; o < stuff.length; o++) {
                                        if (stuff[o] && !stuff[o].includes('\u0000\u0000')) {
                                            try {
                                                plugins[i].scriptOutput(stuff[o]);
                                            } catch (e) {
                                                console.error(e)
                                            }
                                        }
                                    }
                                },
                                pluginConfig.fileReadDelay || 0
                            );
                        }
                    }
                }
            }
			console.log(`Clusterio | Loaded plugin ${pluginsToLoad[i].name} in ${Date.now() - pluginLoadStarted}ms`);
		} else {
			// this plugin doesn't have a client portion. Maybe it runs on the master only?
		}
	}
} // END OF INSTANCE START ---------------------------------------------------------------------

// string, function
// returns [{modName:string,hash:string}, ... ]
function hashMods(instance, callback) {
	if(!callback) {
		throw new Error("ERROR in function hashMods NO CALLBACK");
	}

	function hashMod(name) {
		if (path.extname(name) != ".zip") {
			// Can't hash unzipped mods, return null that's filtered out later
			return null;
		} else {
			return hashFile(instance.path("mods", name)).then(hash => (
				{modName: name, hash: hash}
			));
		}
	}

	let promises = fs.readdirSync(instance.path("mods")).map(hashMod);
	Promise.all(promises).then(hashes => {
		// Remove null entries from hashMod
		callback(hashes.filter(entry => entry !== null));
	});
}

module.exports = {
	// For testing only
	_Instance: Instance,
	_checkFilename: checkFilename,
	_symlinkMods: symlinkMods,
	_Slave: Slave,
};

if (module === require.main) {
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startClient().catch(err => {
		console.error(`
+---------------------------------------------------------------+
| Unexpected error occured while starting client, please report |
| it to https://github.com/clusterio/factorioClusterio/issues   |
+---------------------------------------------------------------+`
		);

		console.error(err);
		process.exit(1);
	});
}
