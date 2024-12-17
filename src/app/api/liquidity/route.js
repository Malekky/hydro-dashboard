import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const dataFilePath = path.join(process.cwd(), 'data', 'liquidity.json');

function ensureDataDirectory() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
}

function readStoredLiquidity() {
    try {
        ensureDataDirectory();
        if (fs.existsSync(dataFilePath)) {
            const data = fs.readFileSync(dataFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading stored liquidity:', error);
    }
    return { liquidity: 0 };
}

function writeLiquidityToFile(liquidityData) {
    try {
        ensureDataDirectory();
        fs.writeFileSync(dataFilePath, JSON.stringify(liquidityData, null, 2));
    } catch (error) {
        console.error('Error writing liquidity to file:', error);
        throw error;
    }
}

export async function GET() {
    try {
        const liquidityData = readStoredLiquidity();
        return NextResponse.json(liquidityData);
    } catch (error) {
        console.error('Error in GET handler:', error);
        return NextResponse.json(
            { error: 'Failed to retrieve liquidity data' },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        const newData = await request.json();
        const validatedData = {
            liquidity: Number(newData.liquidity) || 0
        };

        writeLiquidityToFile(validatedData);
        console.log('Successfully updated liquidity:', validatedData);

        return NextResponse.json({
            success: true,
            data: validatedData
        });
    } catch (error) {
        console.error('Error in POST handler:', error);
        return NextResponse.json(
            { error: 'Failed to update liquidity data' },
            { status: 500 }
        );
    }
}