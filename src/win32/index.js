"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.pack = exports.init = void 0;

const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const child_process_1 = require("child_process");
//@ts-ignore
const qode_1 = require("@nodegui/qode");
//@ts-ignore
const qtConfig_1 = require("@nodegui/nodegui/config/qtConfig");
const patchQode_1 = require("./patchQode");

const cwd = process.cwd();
const deployDirectory = path_1.resolve(cwd, "deploy");
const configFile = path_1.resolve(deployDirectory, "config.json");

/**
 * Console color helpers
 */
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	red: "\x1b[31m"
};

/**
 * Colorizes a console message
 * @param {string} text - Text to colorize
 * @param {string} color - Color to use
 * @returns {string} Colorized text
 */
function colorize(text, color) {
	return `${color}${text}${colors.reset}`;
}

/**
 * Copies qode executable to destination
 */
async function copyQode(dest) {
	// Fix: access qodePath directly from the module
	const qodeBinaryFile = qode_1.qodePath || require.resolve('@nodegui/qode');

	console.log(`Using qode path: ${qodeBinaryFile}`);
	await fs_extra_1.chmod(qodeBinaryFile, "755");
	await fs_extra_1.copyFile(qodeBinaryFile, path_1.resolve(dest, "qode.exe"));
}

/**
 * Copies application distribution files
 */
async function copyAppDist(distPath, resourceDir) {
	await fs_extra_1.copy(distPath, path_1.resolve(resourceDir, "dist"), {
		recursive: true,
	});
}

function getAllNodeAddons(dirPath) {
	const addonExt = "node";
	let dir = fs_extra_1.readdirSync(dirPath);
	return dir
		.filter((elm) => elm.match(new RegExp(`.*\.(${addonExt}$)`, "ig")))
		.map((eachElement) => path_1.resolve(dirPath, eachElement));
}

/**
 * Runs windeployqt for the app
 */
async function runWinDeployQt(appName, buildDir) {
	try {
		console.log(colorize(`Using manual Qt deployment approach...`, colors.bright + colors.blue));

		const qtBinDir = path_1.resolve(qtConfig_1.qtHome, "bin");
		const qtPluginsDir = path_1.resolve(qtConfig_1.qtHome, "plugins");

		const targetPluginsDir = path_1.resolve(buildDir, "plugins");
		await fs_extra_1.mkdirp(targetPluginsDir);

		const qtConfContent = `[Paths]\nPlugins = ./plugins\n`;
		await fs_extra_1.writeFile(path_1.resolve(buildDir, 'qt.conf'), qtConfContent);

		console.log('Copying MSVC runtime DLLs...');
		const vcRedistDir = path_1.resolve(qtBinDir, '../../../vcredist');
		if (await fs_extra_1.pathExists(vcRedistDir)) {
			const vcFiles = await fs_extra_1.readdir(vcRedistDir);
			for (const file of vcFiles) {
				if (file.endsWith('.dll')) {
					await fs_extra_1.copy(
						path_1.resolve(vcRedistDir, file),
						path_1.resolve(buildDir, file)
					);
				}
			}
		} else {
			console.log('MSVC redist dir not found, skipping...');
		}

		console.log('Copying all DLLs from Qt bin directory...');
		try {
			const allFiles = await fs_extra_1.readdir(qtBinDir);
			const dllFiles = allFiles.filter(file => {
				const lowerFile = file.toLowerCase();
				return lowerFile.endsWith('.dll') &&
					!lowerFile.endsWith('d.dll') &&
					!lowerFile.includes('designer') &&
					!lowerFile.includes('help') &&
					!lowerFile.includes('uitool');
			});

			console.log(`Found ${dllFiles.length} DLL files to copy (excluding debug and designer DLLs)`);

			for (const dll of dllFiles) {
				const sourcePath = path_1.resolve(qtBinDir, dll);
				const targetPath = path_1.resolve(buildDir, dll);

				console.log(`Copying ${dll}...`);
				await fs_extra_1.copy(sourcePath, targetPath);
			}
		} catch (err) {
			console.warn(`Warning: Error copying DLLs: ${err.message}`);
		}

		const pluginFolders = [
			"platforms",
			"styles",
			"imageformats",
			"iconengines",
			"sqldrivers",
			"bearer",
			"printsupport"
		];

		for (const folder of pluginFolders) {
			const sourcePluginDir = path_1.resolve(qtPluginsDir, folder);
			const targetPluginDir = path_1.resolve(targetPluginsDir, folder);

			if (await fs_extra_1.pathExists(sourcePluginDir)) {
				console.log(`Copying plugin folder ${folder}...`);
				await fs_extra_1.copy(sourcePluginDir, targetPluginDir);
			} else {
				console.warn(`Warning: Could not find plugin directory ${sourcePluginDir}`);
			}
		}

		const launcherContent = `@echo off
echo Starting application...
start qode.exe
`;
		await fs_extra_1.writeFile(path_1.resolve(buildDir, 'start.bat'), launcherContent);

		console.log(colorize('Manual Qt deployment completed successfully', colors.green));
		return true;
	} catch (error) {
		console.error(colorize(`Error during Qt deployment: ${error}`, colors.red));
		throw new Error(`Failed during Qt deployment: ${error.message || error}`);
	}
}
async function init(appName) {
	console.log(colorize(`Initializing application ${appName}...`, colors.blue));

	// Create necessary directories
	const userTemplate = path_1.resolve(deployDirectory, "win32");
	const appDir = path_1.resolve(userTemplate, appName);

	await fs_extra_1.mkdirp(deployDirectory);
	await fs_extra_1.mkdirp(userTemplate);
	await fs_extra_1.mkdirp(appDir);

	// Write application configuration
	const config = {
		appName: appName,
	};
	await fs_extra_1.writeJSON(configFile, config);

	// Create minimal template structure if template doesn't exist
	const templateDirectory = path_1.resolve(__dirname, "../../template/win32");
	if (await fs_extra_1.pathExists(templateDirectory)) {
		console.log(colorize(`Copying template from ${templateDirectory}`, colors.yellow));
		await fs_extra_1.copy(templateDirectory, appDir, { recursive: true });
	} else {
		console.log(colorize(`Creating minimal template structure`, colors.yellow));
		await fs_extra_1.writeJSON(path_1.resolve(appDir, "package.json"), { name: appName, version: "1.0.0" });
		await fs_extra_1.writeFile(path_1.resolve(appDir, "README.md"), `# ${appName}\n\nBuilt with NodeGUI`);
	}

	console.log(colorize(`Template created at ${appDir}`, colors.green));
}
exports.init = init;

/**
 * Initialize app packaging
 * Pack the application for distribution
 */
async function pack(distPath) {
	const config = await fs_extra_1.readJSON(path_1.resolve(deployDirectory, "config.json"));
	const { appName } = config;
	const usertemplate = path_1.resolve(deployDirectory, "win32");
	const buildDir = path_1.resolve(usertemplate, "build");
	const templateDirectory = path_1.resolve(__dirname, "../../template/win32");
	const templateAppDir = path_1.resolve(usertemplate, appName);
	const buildAppPackage = path_1.resolve(buildDir, appName);

	console.log(`cleaning build directory at ${buildDir}`);
	await fs_extra_1.remove(buildDir);

	console.log(`creating build directory at ${buildDir}`);
	await fs_extra_1.copy(templateAppDir, buildAppPackage, { recursive: true });

	console.log(`copying qode`);
	await copyQode(buildAppPackage);

	console.log(`copying dist`);
	await copyAppDist(distPath, buildAppPackage);

	console.log(`copying package dependencies`);
	await copyPackageDependencies(buildAppPackage);

	console.log(`running windeployqt`);
	await runWinDeployQt(appName, buildAppPackage);

	console.log(`Hiding Qode's console`);
	await patchQode_1.switchToGuiSubsystem(path_1.resolve(buildAppPackage, "qode.exe"));

	console.log(`Build successful. Find the app at ${buildDir}`);
}
exports.pack = pack;

/**
 * Recursively copies node modules from package.json to the build directory
 * Skips @nodegui modules and only includes production dependencies
 * @param {string} buildDir - Build output directory
 */
async function copyPackageDependencies(buildDir) {
	console.log('Copying package dependencies...');

	// Read the project's package.json
	const packageJsonPath = path_1.resolve(cwd, 'package.json');
	if (!await fs_extra_1.pathExists(packageJsonPath)) {
		console.warn('Warning: Could not find package.json, skipping dependency copying');
		return;
	}

	const packageJson = await fs_extra_1.readJSON(packageJsonPath);

	// Get dependencies (excluding devDependencies)
	const dependencies = packageJson.dependencies || {};

	// Create node_modules folder in the build directory
	const targetModulesDir = path_1.resolve(buildDir, 'node_modules');
	await fs_extra_1.mkdirp(targetModulesDir);

	// Copy modules recursively
	const visited = new Set();

	// Always include @nodegui/nodegui if it exists
	if (dependencies['@nodegui/nodegui']) {
		console.log(colorize(`Processing core NodeGUI module: @nodegui/nodegui`, colors.magenta));
		await copyDependencyRecursive('@nodegui/nodegui', targetModulesDir, visited);
	}

	// Process all other non-nodegui dependencies
	for (const [name, version] of Object.entries(dependencies)) {
		// Skip all @nodegui modules (we already handled the core one)
		if (name.startsWith('@nodegui/')) {
			console.log(colorize(`Skipping ${name} (nodegui module)`, colors.yellow));
			continue;
		}

		console.log(colorize(`Processing dependency: ${name}`, colors.blue));
		await copyDependencyRecursive(name, targetModulesDir, visited);
	}

	console.log(colorize('Finished copying package dependencies', colors.green));
}

/**
 * Recursively copies a dependency and its sub-dependencies
 * @param {string} name - Package name
 * @param {string} targetDir - Target node_modules directory
 * @param {Set} visited - Set of already visited modules (to prevent circular dependencies)
 */
async function copyDependencyRecursive(name, targetDir, visited) {
	// Skip already visited modules to prevent circular dependencies
	if (visited.has(name)) {
		return;
	}
	visited.add(name);

	const modulePath = path_1.resolve(cwd, 'node_modules', name);
	const targetPath = path_1.resolve(targetDir, name);

	console.log(colorize(`Copying module: ${name}`, colors.cyan));
	// Check if module exists
	if (!await fs_extra_1.pathExists(modulePath)) {
		console.warn(colorize(`Warning: Could not find module ${name}`, colors.yellow));
		return;
	}
	// Copy the module without its node_modules folder
	await fs_extra_1.copy(modulePath, targetPath, {
		filter: (src) => !src.includes(path_1.join(modulePath, 'node_modules'))
	});

	// If this is the nodegui module, remove the miniqt folder to reduce size
	if (name === '@nodegui/nodegui') {
		// Remove miniqt folder
		const miniqtPath = path_1.resolve(targetPath, 'miniqt');
		if (await fs_extra_1.pathExists(miniqtPath)) {
			console.log(colorize(`Removing miniqt folder from ${name} to reduce size`, colors.yellow));
			try {
				// Use rm with recursive: true and force: true to handle nested directories and read-only files
				await fs_extra_1.rm(miniqtPath, {
					recursive: true,
					force: true
				});
				console.log(colorize(`Successfully removed miniqt folder`, colors.green));
			} catch (err) {
				// If rm fails, try other approach
				console.warn(colorize(`Warning: Failed to remove miniqt folder: ${err.message}`, colors.yellow));
				console.log(colorize(`Keeping miniqt folder but removing contents to reduce size`, colors.yellow));

				try {
					// Alternative: Empty directory but keep the structure
					const miniqtContents = await fs_extra_1.readdir(miniqtPath);
					for (const item of miniqtContents) {
						await fs_extra_1.remove(path_1.resolve(miniqtPath, item)).catch(() => { });
					}
				} catch (innerErr) {
					console.warn(colorize(`Warning: Could not clean miniqt folder: ${innerErr.message}`, colors.yellow));
				}
			}
		}

		// Remove src folder
		const srcPath = path_1.resolve(targetPath, 'src');
		if (await fs_extra_1.pathExists(srcPath)) {
			console.log(colorize(`Removing src folder from ${name} to reduce size`, colors.yellow));
			try {
				await fs_extra_1.rm(srcPath, { recursive: true, force: true });
				console.log(colorize(`Successfully removed src folder`, colors.green));
			} catch (err) {
				console.warn(colorize(`Warning: Failed to remove src folder: ${err.message}`, colors.yellow));
			}
		}

		// Remove build/*.lib and *.exp files
		const buildReleasePath = path_1.resolve(targetPath, 'build', 'Release');
		if (await fs_extra_1.pathExists(buildReleasePath)) {
			const libFile = path_1.resolve(buildReleasePath, 'nodegui_core.lib');
			const expFile = path_1.resolve(buildReleasePath, 'nodegui_core.exp');

			console.log(colorize(`Removing nodegui_core.lib and nodegui_core.exp files to reduce size`, colors.yellow));

			// Remove lib file
			if (await fs_extra_1.pathExists(libFile)) {
				try {
					await fs_extra_1.remove(libFile);
					console.log(colorize(`Successfully removed nodegui_core.lib file`, colors.green));
				} catch (err) {
					console.warn(colorize(`Warning: Failed to remove nodegui_core.lib file: ${err.message}`, colors.yellow));
				}
			}

			// Remove exp file
			if (await fs_extra_1.pathExists(expFile)) {
				try {
					await fs_extra_1.remove(expFile);
					console.log(colorize(`Successfully removed nodegui_core.exp file`, colors.green));
				} catch (err) {
					console.warn(colorize(`Warning: Failed to remove nodegui_core.exp file: ${err.message}`, colors.yellow));
				}
			}
		}
	}

	// Copy .bin directory at the top level if it exists and hasn't been processed yet
	if (!visited.has('.bin')) {
		const firstPackage = name.split('/')[0]; // Get the root package name (handles scoped packages)
		const isFirstLevelDependency = !name.includes('node_modules');

		// Only copy .bin directory when processing a top-level dependency
		if (isFirstLevelDependency) {
			const binPath = path_1.resolve(cwd, 'node_modules', '.bin');
			const targetBinPath = path_1.resolve(targetDir, '.bin');

			if (await fs_extra_1.pathExists(binPath)) {
				console.log(colorize(`Copying .bin directory with executables`, colors.magenta));
				await fs_extra_1.copy(binPath, targetBinPath, { recursive: true });
				visited.add('.bin');
			}
		}
	}

	// Copy package-lock.json if it exists and hasn't been processed yet
	if (!visited.has('package-lock.json')) {
		const packageLockPath = path_1.resolve(cwd, 'node_modules', 'package-lock.json');
		const targetPackageLockPath = path_1.resolve(targetDir, 'package-lock.json');

		if (await fs_extra_1.pathExists(packageLockPath)) {
			console.log(colorize(`Copying package-lock.json`, colors.magenta));
			await fs_extra_1.copy(packageLockPath, targetPackageLockPath);
			visited.add('package-lock.json');
		}
	}

	// Read the module's package.json
	const modulePackageJsonPath = path_1.resolve(modulePath, 'package.json');
	if (!await fs_extra_1.pathExists(modulePackageJsonPath)) {
		return;
	}

	// Read dependencies from module's package.json
	try {
		const modulePackageJson = await fs_extra_1.readJSON(modulePackageJsonPath);
		const moduleDependencies = modulePackageJson.dependencies || {};

		// Recursively copy each dependency
		for (const [depName, depVersion] of Object.entries(moduleDependencies)) {
			// Skip all @nodegui modules except the core one
			if (depName.startsWith('@nodegui/') && depName !== '@nodegui/nodegui') {
				continue;
			}

			// Recursively copy each dependency
			await copyDependencyRecursive(depName, targetDir, visited);
		}
	} catch (err) {
		console.warn(`Warning: Error processing dependencies for ${name}: ${err.message}`);
	}
}