declare module 'decomposerize' {
    interface ConfigurationOptions {
        command?: string;
        rm?: boolean;
        detach?: boolean;
        multiline?: boolean;
        'long-args'?: boolean;
        'arg-value-separator'?: string;
    }

    function convertToDockerRunCommands(dockerComposeContent: string, configuration?: ConfigurationOptions): string;

    export = convertToDockerRunCommands;
}