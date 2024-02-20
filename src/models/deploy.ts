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

export type DeploymentScript = DockerDeploymentScript | ShellDeploymentScript | DockerComposeDeploymentScript;