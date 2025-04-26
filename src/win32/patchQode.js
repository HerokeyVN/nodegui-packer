"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.switchToGuiSubsystem = exports.runWinDeployQt = void 0;
const fs = require("fs");
const child_process = require("child_process");
const path = require("path");
const { promisify } = require('util');

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

const PE_SIGNATURE_OFFSET_LOCATION = 0x3c;
function getPESignatureOffset(fd) {
    const PESignatureOffsetBuffer = Buffer.alloc(4);
    fs.readSync(fd, PESignatureOffsetBuffer, 0, 4, PE_SIGNATURE_OFFSET_LOCATION);
    return PESignatureOffsetBuffer.readUInt32LE(0);
}
function validatePESignature(fd, signatureOffset) {
    const PESignatureBuffer = Buffer.alloc(4);
    fs.readSync(fd, PESignatureBuffer, 0, 4, signatureOffset);
    if (PESignatureBuffer.toString() !== "PE\0\0") {
        throw new Error("Not a PE file. aborting");
    }
}
function validatePEImageFormats(fd, optionalHeaderOffset) {
    const magicHeaderBuffer = Buffer.alloc(2);
    fs.readSync(fd, magicHeaderBuffer, 0, 2, optionalHeaderOffset);
    const magicHeaders = magicHeaderBuffer.readUInt16LE(0);
    if (magicHeaders === 0x20b) {
        return "PE32+";
    }
    else if (magicHeaders === 0x10b) {
        return "PE32";
    }
    else {
        throw new Error("Unknown PE format!" + magicHeaders);
    }
}
function getOptionalHeaderOffset(signatureOffset) {
    const COFFHeaderOffset = signatureOffset + 4; // add the bytes occupied by the signature
    const COFFHeaderSize = 20; // the fixed coffheadersize
    const OptionalHeaderOffset = COFFHeaderOffset + COFFHeaderSize;
    return OptionalHeaderOffset;
}
function switchIfCui(fd, subsystemOffset) {
    const subsystemBuffer = Buffer.alloc(2);
    fs.readSync(fd, subsystemBuffer, 0, 2, subsystemOffset);
    const subsystem = subsystemBuffer.readUInt16LE(0);
    if (subsystem !== 3) {
        return console.log(colorize(`Subsystem found to be: ${subsystem}. Not switching.. aborting`, colors.yellow));
    }
    console.log(colorize(`Switching to GUI subsystem IMAGE_SUBSYSTEM_WINDOWS_GUI: ${2}`, colors.cyan));
    const GUISubsytemBuffer = Buffer.alloc(2);
    GUISubsytemBuffer.writeUInt16LE(0x02, 0);
    fs.writeSync(fd, GUISubsytemBuffer, 0, 2, subsystemOffset);
}

/**
 * Runs windeployqt on the specified executable
 * @param {string} filePath - Path to the executable
 * @param {Object} options - Configuration options
 * @param {string} options.qtDir - Qt installation directory (optional)
 * @param {string} options.qmlDir - Directory with QML files (optional)
 * @param {boolean} options.debug - Whether to deploy debug binaries (optional)
 * @param {boolean} options.release - Whether to deploy release binaries (optional)
 * @param {string} options.translationDir - Directory to copy translations (optional)
 * @param {string[]} options.extraArgs - Additional arguments to pass to windeployqt (optional)
 * @returns {Promise<string>} - Output from the windeployqt command
 */
async function runWinDeployQt(filePath, options = {}) {
    const args = [filePath];
    
    if (options.qmlDir) {
        args.unshift('--qmldir', options.qmlDir);
    }
    
    if (options.debug) {
        args.unshift('--debug');
    } else if (options.release) {
        args.unshift('--release');
    }
    
    if (options.translationDir) {
        args.unshift('--translationdir', options.translationDir);
    }
    
    if (Array.isArray(options.extraArgs)) {
        args.unshift(...options.extraArgs);
    }
    
    let windeployqtPath = 'windeployqt';
    if (options.qtDir) {
        windeployqtPath = path.join(options.qtDir, 'bin', 'windeployqt');
    }
    
    console.log(colorize(`Running: ${windeployqtPath} ${args.join(' ')}`, colors.blue));
    
    return new Promise((resolve, reject) => {
        const process = child_process.spawn(windeployqtPath, args, { 
            shell: true,
            stdio: 'pipe'
        });
        
        let output = '';
        let error = '';
        
        process.stdout.on('data', (data) => {
            output += data.toString();
            console.log(data.toString()); // Keep stdout as is, often formatted by the tool
        });
        
        process.stderr.on('data', (data) => {
            error += data.toString();
            // Color stderr output red for visibility
            console.error(colorize(data.toString(), colors.red));
        });
        
        process.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`windeployqt failed with code ${code}: ${error}`));
            } else {
                resolve(output);
            }
        });
    });
}

// Modify switchToGuiSubsystem to be async as well
async function switchToGuiSubsystem(filePath, windeployqtOptions) {
    const fd = fs.openSync(filePath, "r+");
    try {
        const PESignatureOffset = getPESignatureOffset(fd);
        validatePESignature(fd, PESignatureOffset);
        const optionalHeaderOffset = getOptionalHeaderOffset(PESignatureOffset);
        const imageFormat = validatePEImageFormats(fd, optionalHeaderOffset);
        console.log(colorize(`Found a valid ${imageFormat} executable file`, colors.green));
        const subsystemOffset = optionalHeaderOffset + 68; // From https://docs.microsoft.com/en-us/windows/win32/debug/pe-format#optional-header-windows-specific-fields-image-only
        switchIfCui(fd, subsystemOffset);
        
        // Close the file descriptor before running windeployqt
        fs.closeSync(fd);
        
        // Run windeployqt if options are provided
        if (windeployqtOptions) {
            try {
                const output = await runWinDeployQt(filePath, windeployqtOptions);
                console.log(colorize('windeployqt completed successfully', colors.green));
                return output;
            } catch (err) {
                console.error(colorize('windeployqt failed:', colors.red), err);
                throw err;
            }
        }
    } catch (err) {
        // Make sure to close the file descriptor in case of errors
        fs.closeSync(fd);
        console.error(colorize('Error switching subsystem:', colors.red), err);
        throw err;
    }
}

// Add new export for the windeployqt function
exports.switchToGuiSubsystem = switchToGuiSubsystem;
exports.runWinDeployQt = runWinDeployQt;
//# sourceMappingURL=patchQode.js.map