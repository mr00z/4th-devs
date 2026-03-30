import { planRoute } from './src/planner.js'

const knowledge = {
  mapRows: [
    '........WW',
    '.......WW.',
    '.T....WW..',
    '......W...',
    '..T...W.G.',
    '....R.W...',
    '...RR.WW..',
    'SR.....W..',
    '......WW..',
    '.....WW...'
  ],
  width: 10,
  height: 10,
  start: { x: 0, y: 7 },
  target: { x: 8, y: 4 },
  vehicles: [
    { name: 'walk', fuelPerMove: 0, foodPerMove: 2.5 },
    { name: 'horse', fuelPerMove: 0, foodPerMove: 1.6 },
    { name: 'car', fuelPerMove: 0.7, foodPerMove: 1 },
    { name: 'rocket', fuelPerMove: 1, foodPerMove: 0.1 }
  ],
  terrainRules: [
    { symbol: 'R', blockedFor: ['walk', 'horse', 'car', 'rocket'] },
    { symbol: 'W', blockedFor: ['car', 'rocket'] }
  ],
  notes: []
}

const result = planRoute(knowledge)
console.log('Result:', JSON.stringify(result, null, 2))
