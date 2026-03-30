// Quick test for terrain extraction
const text1 = `The rocket is the fastest possible solution for moving around the world in this mission. It cannot travel over water, because it only hovers about one meter above the ground.`

const text2 = `The car is a practical powered vehicle. It cannot drive on water, and entering a water tile means the vehicle is lost immediately.`

const text3 = `R marks rocks that block movement completely`

function testTerrain(text: string, label: string) {
  const waterMatch = /cannot\s+(?:drive|travel|fly)\s+(?:on|over)\s+water/i.test(text)
  const waterLossMatch = /entering\s+a\s+water\s+tile.*vehicle\s+is\s+lost/i.test(text)
  const rocksMatch = /rocks?\s+block/i.test(text) || /R marks rocks that block movement completely/i.test(text)
  
  console.log(`\n[${label}]`)
  console.log('  waterMatch:', waterMatch)
  console.log('  waterLossMatch:', waterLossMatch)
  console.log('  rocksMatch:', rocksMatch)
}

testTerrain(text1, 'rocket response')
testTerrain(text2, 'car response')
testTerrain(text3, 'legend response')
