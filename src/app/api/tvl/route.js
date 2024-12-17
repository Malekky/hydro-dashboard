import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const dataFilePath = path.join(process.cwd(), 'data', 'tvl.json');

function ensureDataDirectory() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
}

function readStoredTVL() {
    try {
        ensureDataDirectory();
        if (fs.existsSync(dataFilePath)) {
            const data = fs.readFileSync(dataFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading stored TVL:', error);
    }
    return { tvl: 0 };
}

function writeTVLToFile(tvlData) {
    try {
        ensureDataDirectory();
        fs.writeFileSync(dataFilePath, JSON.stringify(tvlData, null, 2));
    } catch (error) {
        console.error('Error writing TVL to file:', error);
        throw error;
    }
}

export async function GET() {
    try {
        const tvlData = readStoredTVL();
        return NextResponse.json(tvlData);
    } catch (error) {
        console.error('Error in GET handler:', error);
        return NextResponse.json(
            { error: 'Failed to retrieve TVL data' },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        const newData = await request.json();
        const validatedData = {
            tvl: Number(newData.tvl) || 0
        };

        writeTVLToFile(validatedData);
        console.log('Successfully updated TVL:', validatedData);

        return NextResponse.json({
            success: true,
            data: validatedData
        });
    } catch (error) {
        console.error('Error in POST handler:', error);
        return NextResponse.json(
            { error: 'Failed to update TVL data' },
            { status: 500 }
        );
    }
}