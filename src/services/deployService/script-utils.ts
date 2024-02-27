
import { Service } from '@prisma/client';
import { CdkTypescriptGithubDeploymentScript, DeploymentScript, DockerComposeDeploymentScript, DockerDeploymentScript, NextjsDeploymentScript } from '@src/models/deploy';
import { readFileSync } from 'fs';
import { DeploymentKey } from './types';
import fs, { mkdirSync } from 'fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import shell from 'shelljs';

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

export async function deployCdk(deploymentId: string, keys: DeploymentKey, script: CdkTypescriptGithubDeploymentScript) {
    if (!keys.accountNumber || !keys.awsRegion) {
        throw new Error("AWS region and account number are required for CDK deployments");
    }
    const dir = `./installs/${deploymentId}`;
    mkdirSync(dir);
    await git.clone({
        fs, http, dir, url: script.repoUrl, onAuth: () => {
            return {
                username: script.auth?.username,
                password: script.auth?.accessToken,
            };
        },
    });
    shell.env["AWS_ACCESS_KEY_ID"] = keys.accessKey;
    shell.env["AWS_SECRET_ACCESS_KEY"] = keys.secretAccessKey;
    shell.env["AWS_DEFAULT_REGION"] = keys.awsRegion ?? "us-east-1";
    shell.cd(dir);
    shell.exec("npm install");
    shell.exec(`cdk bootstrap aws://${keys.accountNumber}/${keys.awsRegion} --require-approval never`);
    shell.exec("cdk deploy --require-approval never");
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