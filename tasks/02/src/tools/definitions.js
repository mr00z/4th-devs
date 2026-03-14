export const tools = [
  {
    type: "function",
    name: "get_candidate_localization",
    description: "Get a list of coordinates of a candidate",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the candidate"
        },
        surname: {
          type: "string",
          description: "Surname of the candidate"
        }
      },
      required: ["name", "surname"],
      additionalProperties: false,
      strict: true
    },
  },
  {
    type: "function",
    name: "get_candidate_access_level",
    description: "Get the access level of a candidate",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the candidate"
        },
        surname: {
          type: "string",
          description: "Surname of the candidate"
        },
        birthYear: {
          type: "number",
          description: "Birth year of the candidate. Example: 1987"
        }
      },
      required: ["name", "surname"],
      additionalProperties: false,
      strict: true
    },
  },
  {
    type: "function",
    name: "get_distance",
    description: 'Get the distance between two points in the format "lat,lon"',
    parameters: {
      type: "object",
      properties: {
        point1: {
          type: "string",
          description: 'First point in the format "lat,lon"'
        },
        point2: {
          type: "string",
          description: 'Second point in the format "lat,lon"'
        }
      },
      required: ["point1", "point2"],
      additionalProperties: false,
      strict: true
    },
  },
];
