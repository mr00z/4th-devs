export const schema = {
    type: "json_schema",
    name: "best_person",
    strict: true,
    schema: {
        type: "object",
        properties: {
            name: { type: "string" },
            surname: { type: "string" },
            accessLevel: { type: "number" },
            powerPlant: { type: "string", description: "Power plant code for example: PWR7264PL" }
        },
        required: ["name", "surname", "accessLevel", "powerPlant"],
        additionalProperties: false
    }

}