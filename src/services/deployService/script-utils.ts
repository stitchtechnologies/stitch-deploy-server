
import { Service } from '@prisma/client';
import { DeploymentScript, DockerComposeDeploymentScript, DockerDeploymentScript, NextjsDeploymentScript } from '@src/models/deploy';
import { readFileSync } from 'fs';

export function generateEnvFileScript(servicesEnvironmentVariables: Record<string, string>[]) {
    const keyValues = servicesEnvironmentVariables.flatMap(Object.entries).map(([key, value]) => `${key}="${value}"`).join('\n');
    return `cat << EOF > .env
${keyValues}
EOF
source .env`;
}

export function combineScripts(mainScript: string, envScript: string) {
    let combinedScript = '';
    const hasHeader = mainScript.trim().startsWith('#!/bin/bash');
    if (hasHeader) {
        combinedScript += '#!/bin/bash\n';
    }
    combinedScript += envScript;
    combinedScript += '\n';

    if (hasHeader) {
        combinedScript += mainScript.replace('#!/bin/bash', '');
    }
    return combinedScript;
}

export function generateDockerScript(dockerScript: DockerDeploymentScript | NextjsDeploymentScript) {
    let installDockerScript = readFileSync('./src/deploymentScripts/installDocker.sh', 'utf8');
    installDockerScript += '\n';
    if (dockerScript.portMappings.length <= 0) {
        installDockerScript += `docker run -d ${dockerScript.image}`;
        return installDockerScript;
    }

    const portMappings = dockerScript.portMappings.map(pm => `${pm.serverPort}:${pm.containerPort}`);
    installDockerScript += `docker run -d -p ${portMappings} ${dockerScript.image}`;
    return installDockerScript;
}

export function generateDockerComposeScript(dockerComposeScript: DockerComposeDeploymentScript) {
    let installDockerScript = readFileSync('./src/deploymentScripts/installDocker.sh', 'utf8');
    installDockerScript += '\n';
    installDockerScript += 'mkdir stitch && cd stitch';
    installDockerScript += '\n';

    installDockerScript += `cat << EOF > docker-compose.yml
${dockerComposeScript.composeFile}
EOF`;

    installDockerScript += '\n';
    installDockerScript += 'sudo docker-compose up -d';

    return installDockerScript;
}

export function generateV2Script(service: Service) {
    const deploymentScript = service.scriptV2 as DeploymentScript;
    switch (deploymentScript.type) {
        case 'docker':
        case 'next-js':
            return generateDockerScript(deploymentScript);
        case 'shell':
            return deploymentScript.script;
        case 'docker-compose':
            return generateDockerComposeScript(deploymentScript);
    }
    throw new Error('script not defined');
}

export function generateUserDataScript(service: Service) {
    if (service.scriptV2) {
        return generateV2Script(service);
    }

    return service.script.trim();
}