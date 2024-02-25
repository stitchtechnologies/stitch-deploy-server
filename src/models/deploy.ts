export type DockerDeploymentScript = {
    type: "docker",
    image: string,
    portMappings: Array<{ containerPort: number, serverPort: number }>
}

export type DockerComposeDeploymentScript = {
    type: "docker-compose",
    composeFile: string,
}

export type ShellDeploymentScript = {
    type: "shell",
    script: string,
}

export type NextjsDeploymentScript = {
    type: "next-js",
    image: string,
    portMappings: Array<{ containerPort: number, serverPort: number }>
}

export type CdkTypescriptGithubDeploymentScript = {
    type: "cdk-ts-github",
    repoUrl: string,
    auth?: {
        username: string,
        accessToken: string
    }
}

export type DeploymentScript = DockerDeploymentScript | ShellDeploymentScript | DockerComposeDeploymentScript | CdkTypescriptGithubDeploymentScript | NextjsDeploymentScript;
