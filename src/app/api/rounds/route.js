import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Define the path for our data file
const dataFilePath = path.join(process.cwd(), 'data', 'roundsData.json');

// Helper function to ensure the data directory exists
function ensureDataDirectory() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }
}

// Helper function to read stored rounds data
function readStoredRoundsData() {
  try {
    ensureDataDirectory();
    if (fs.existsSync(dataFilePath)) {
      const data = fs.readFileSync(dataFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading stored rounds data:', error);
  }
  return {
    rounds: []
  };
}

// Helper function to write rounds data to file
function writeRoundsDataToFile(data) {
  try {
    ensureDataDirectory();
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing rounds data to file:', error);
    throw error;
  }
}

// Validate the liquidity distribution data
function validateLiquidityDistribution(data) {
  return {
    name: String(data.name || ''),
    value: Number(data.value) || 0,
    percentage: Number(data.percentage) || 0,
    color: String(data.color || '')
  };
}

// Validate the round data
function validateRoundData(data) {
  return {
    round: Number(data.round),
    trancheSize: Number(data.trancheSize) || 0,
    tributesPaid: Number(data.tributesPaid) || 0,
    projectsParticipated: Number(data.projectsParticipated) || 0,
    liquidityWon: Array.isArray(data.liquidityWon)
      ? data.liquidityWon.map(validateLiquidityDistribution)
      : []
  };
}

export async function GET() {
  try {
    const roundsData = readStoredRoundsData();
    return NextResponse.json(roundsData);
  } catch (error) {
    console.error('Error in GET handler:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve rounds data' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const newData = await request.json();
    
    // Validate the entire data structure
    const validatedData = {
      rounds: Array.isArray(newData.rounds)
        ? newData.rounds.map(validateRoundData)
        : []
    };

    writeRoundsDataToFile(validatedData);
    console.log('Successfully updated rounds data:', validatedData);

    return NextResponse.json({
      success: true,
      data: validatedData
    });
  } catch (error) {
    console.error('Error in POST handler:', error);
    return NextResponse.json(
      { error: 'Failed to update rounds data' },
      { status: 500 }
    );
  }
}