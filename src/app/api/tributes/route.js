import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Define the path for our data file
const dataFilePath = path.join(process.cwd(), 'data', 'tributeMetrics.json');

// Helper function to ensure the data directory exists
function ensureDataDirectory() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
}

// Helper function to read stored metrics
function readStoredMetrics() {
    try {
        ensureDataDirectory();
        if (fs.existsSync(dataFilePath)) {
            const data = fs.readFileSync(dataFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading stored metrics:', error);
    }
    
    return {
        totalTributes: 0,
        lowestTribute: 0,
        averageTribute: 0,
        highestTribute: 0,
        projectTributes: []
    };
}

// Helper function to write metrics to file
function writeMetricsToFile(metrics) {
    try {
        ensureDataDirectory();
        fs.writeFileSync(dataFilePath, JSON.stringify(metrics, null, 2));
    } catch (error) {
        console.error('Error writing metrics to file:', error);
        throw error;
    }
}

export async function GET() {
    try {
        const metrics = readStoredMetrics();
        return NextResponse.json(metrics);
    } catch (error) {
        console.error('Error in GET handler:', error);
        return NextResponse.json(
            { error: 'Failed to retrieve tribute metrics' },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        const newMetrics = await request.json();
        
        const validatedMetrics = {
            totalTributes: Number(newMetrics.totalTributes) || 0,
            lowestTribute: Number(newMetrics.lowestTribute) || 0,
            averageTribute: Number(newMetrics.averageTribute) || 0,
            highestTribute: Number(newMetrics.highestTribute) || 0,
            projectTributes: Array.isArray(newMetrics.projectTributes) 
                ? newMetrics.projectTributes.map(project => ({
                    name: String(project.name),
                    value: Number(project.value),
                    color: String(project.color)
                }))
                : []
        };

        writeMetricsToFile(validatedMetrics);
        console.log('Successfully updated tribute metrics:', validatedMetrics);

        return NextResponse.json({
            success: true,
            data: validatedMetrics
        });
    } catch (error) {
        console.error('Error in POST handler:', error);
        return NextResponse.json(
            { error: 'Failed to update tribute metrics' },
            { status: 500 }
        );
    }
}