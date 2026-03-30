// Test terrain blocking logic

interface TerrainRule {
  symbol: string
  blockedFor?: string[]
}

interface VehicleRule {
  name: string
  fuelPerMove: number
  foodPerMove: number
}

function terrainRuleFor(symbol: string, rules: TerrainRule[]): TerrainRule | undefined {
  return rules.find((rule) => rule.symbol === symbol)
}

function canUseVehicleOnTerrain(vehicle: VehicleRule, terrainSymbol: string, terrainRule: TerrainRule | undefined): boolean {
  const id = terrainSymbol.toLowerCase()

  if (vehicle.blockedTerrains?.includes(id)) {
    return false
  }

  if (vehicle.allowedTerrains && vehicle.allowedTerrains.length > 0 && !vehicle.allowedTerrains.includes(id)) {
    return false
  }

  if (terrainRule?.blockedFor?.includes(vehicle.name)) {
    console.error(`[BLOCKED] ${vehicle.name} blocked on ${terrainSymbol}`)
    return false
  }

  if (terrainRule?.allowedFor && terrainRule.allowedFor.length > 0 && !terrainRule.allowedFor.includes(vehicle.name)) {
    return false
  }

  return true
}

const terrainRules: TerrainRule[] = [
  { symbol: 'R', blockedFor: ['walk', 'horse', 'car', 'rocket'] },
  { symbol: 'W', blockedFor: ['car', 'rocket'] }
]

const rocket: VehicleRule = { name: 'rocket', fuelPerMove: 1, foodPerMove: 0.1 }
const horse: VehicleRule = { name: 'horse', fuelPerMove: 0, foodPerMove: 1.6 }

console.log('Testing rocket on W:')
const wRule = terrainRuleFor('W', terrainRules)
console.log('  W rule:', JSON.stringify(wRule))
console.log('  rocket.name:', rocket.name)
console.log('  blockedFor includes rocket?', wRule?.blockedFor?.includes(rocket.name))
console.log('  canUse:', canUseVehicleOnTerrain(rocket, 'W', wRule))

console.log('\nTesting horse on W:')
console.log('  canUse:', canUseVehicleOnTerrain(horse, 'W', wRule))

console.log('\nTesting rocket on R:')
const rRule = terrainRuleFor('R', terrainRules)
console.log('  canUse:', canUseVehicleOnTerrain(rocket, 'R', rRule))
