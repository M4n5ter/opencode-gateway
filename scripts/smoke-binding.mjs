import { loadGatewayBindingModule } from "../packages/opencode-plugin/src/binding.ts"

const module = await loadGatewayBindingModule()
if (typeof module.gatewayStatus !== "function") {
    throw new Error("gatewayStatus export is unavailable")
}
if (typeof module.nextCronRunAt !== "function") {
    throw new Error("nextCronRunAt export is unavailable")
}
if (typeof module.ProgressiveTextHandle?.progressive !== "function") {
    throw new Error("ProgressiveTextHandle progressive constructor is unavailable")
}

module.gatewayStatus()
module.nextCronRunAt(
    {
        id: "nightly",
        schedule: "0 9 * * *",
        prompt: "Summarize work",
        deliveryChannel: null,
        deliveryTarget: null,
        deliveryTopic: null,
    },
    1_735_689_600_000,
)
module.ProgressiveTextHandle.progressive(400)
