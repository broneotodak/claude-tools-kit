#!/usr/bin/env node

/**
 * Machine Detection Utility for CTK
 * Provides standardized machine name detection across all CTK tools
 */

const os = require('os');

/**
 * Get standardized machine name based on hostname and platform
 * @returns {string} Standardized machine name
 */
function getStandardizedMachineName() {
    const rawHostname = os.hostname().toLowerCase();
    const platform = os.platform();
    
    // MacBook detection
    if (rawHostname.includes('macbook')) {
        return 'MacBook Pro';
    }
    
    // Windows PC detection
    if (rawHostname === 'neo-mothership' || 
        rawHostname === 'desktop-neo-win11' || 
        rawHostname.includes('neo-pc')) {
        return 'Windows Home PC';
    }
    
    // Office PC detection
    if (rawHostname.includes('office') || rawHostname.includes('work')) {
        return 'Windows Office PC';
    }
    
    // Server detection
    if (rawHostname.includes('server') || rawHostname.includes('prod')) {
        return 'Production Server';
    }
    
    // Cloud/Virtual detection
    if (rawHostname.includes('aws') || 
        rawHostname.includes('gcp') || 
        rawHostname.includes('azure') ||
        rawHostname.includes('digital') ||
        rawHostname.includes('linode')) {
        return 'Cloud Server';
    }
    
    // WSL detection
    if (platform === 'linux' && process.env.WSL_DISTRO_NAME) {
        return 'Windows WSL';
    }
    
    // Generic fallbacks
    if (platform === 'darwin') {
        return 'Mac';
    } else if (platform === 'win32') {
        return 'Windows PC';
    } else if (platform === 'linux') {
        return 'Linux PC';
    }
    
    // Last resort: use hostname
    return rawHostname;
}

/**
 * Get detailed machine information
 * @returns {object} Machine details
 */
function getMachineInfo() {
    return {
        standardizedName: getStandardizedMachineName(),
        hostname: os.hostname(),
        platform: os.platform(),
        type: os.type(),
        arch: os.arch(),
        release: os.release(),
        totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
        cpus: os.cpus().length,
        uptime: Math.round(os.uptime() / 60) + ' minutes'
    };
}

/**
 * Update .env file with machine name
 */
function updateEnvFile() {
    const fs = require('fs');
    const path = require('path');
    
    const envPath = path.join(__dirname, '..', '.env');
    const machineName = getStandardizedMachineName();
    
    try {
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        // Remove existing MACHINE_NAME if present
        envContent = envContent.replace(/^MACHINE_NAME=.*$/m, '');
        
        // Add new MACHINE_NAME
        if (!envContent.endsWith('\n')) {
            envContent += '\n';
        }
        envContent += `MACHINE_NAME="${machineName}"\n`;
        
        fs.writeFileSync(envPath, envContent);
        console.log(`✅ Updated .env with MACHINE_NAME="${machineName}"`);
        
        return machineName;
    } catch (error) {
        console.error('❌ Failed to update .env file:', error);
        return machineName;
    }
}

// CLI Interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Machine Detection Utility for CTK

Usage: node machine-detection.js [options]

Options:
  --name, -n        Show standardized machine name only
  --info, -i        Show detailed machine information
  --update-env, -u  Update .env file with machine name
  --help, -h        Show this help message

Examples:
  node machine-detection.js --name
  node machine-detection.js --info
  node machine-detection.js --update-env
`);
        process.exit(0);
    }
    
    if (args.includes('--name') || args.includes('-n')) {
        console.log(getStandardizedMachineName());
    } else if (args.includes('--info') || args.includes('-i')) {
        const info = getMachineInfo();
        console.log('🖥️ Machine Information:');
        console.log(`   Standardized Name: ${info.standardizedName}`);
        console.log(`   Hostname: ${info.hostname}`);
        console.log(`   Platform: ${info.platform} (${info.type})`);
        console.log(`   Architecture: ${info.arch}`);
        console.log(`   Release: ${info.release}`);
        console.log(`   Memory: ${info.totalMemory}`);
        console.log(`   CPUs: ${info.cpus}`);
        console.log(`   Uptime: ${info.uptime}`);
    } else if (args.includes('--update-env') || args.includes('-u')) {
        updateEnvFile();
    } else {
        // Default: show standardized name
        console.log(getStandardizedMachineName());
    }
}

module.exports = {
    getStandardizedMachineName,
    getMachineInfo,
    updateEnvFile
};
