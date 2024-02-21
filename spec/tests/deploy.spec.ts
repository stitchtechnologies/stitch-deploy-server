import { generateDockerComposeScript } from "@src/services/DeployService"
import { readFileSync } from "fs"
describe('DeployService', () => {
    it("should turn a docker compose file into a bash command", () => {
        const dockerComposeInput = readFileSync("/Users/rajdosanjh/git/stitch-deploy-server/spec/resouces/docker-compose.yml", "utf-8");

        const result = generateDockerComposeScript({
            type: "docker-compose",
            composeFile: dockerComposeInput
        })

        console.log(result);
    })
})  