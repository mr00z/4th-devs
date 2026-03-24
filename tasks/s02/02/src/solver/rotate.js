export const rotateOpeningsClockwise = (openings) => {
    const map = { N: "E", E: "S", S: "W", W: "N" };
    return openings.map((side) => map[side]).sort();
};

export const rotationDistance = (current, target) => {
    let probe = [...current].sort();
    const wanted = [...target].sort().join("");

    for (let steps = 0; steps < 4; steps += 1) {
        if (probe.join("") === wanted) {
            return steps;
        }
        probe = rotateOpeningsClockwise(probe);
    }

    return null;
};
