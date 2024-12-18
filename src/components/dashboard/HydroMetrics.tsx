"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpIcon } from "lucide-react";
import {
  Tooltip, ResponsiveContainer, Legend, Treemap, PieChart, Pie, Cell
} from "recharts";

interface ProjectTribute {
  name: string;
  value: number;
  color: string;
}

interface Project {
  name: string;
  category: string;
}

interface ProjectsData {
  projects: Project[];
  tributesByProject: ProjectTribute[];
}

interface TributeMetrics {
  totalTributes: number;
  lowestTribute: number;
  averageTribute: number;
  highestTribute: number;
  projectTributes: ProjectTribute[];
}

const overviewData = {
  totalRevenue: 250000,
  communityPoolAPR: 15.5,
  ProjectsQuotatoCommunityPoolRevenue: [
    { name: "Osmosis", value: 35000, percentage: 35, color: "#8884d8" },
    { name: "Stride", value: 25000, percentage: 25, color: "#82ca9d" },
    { name: "Astroport", value: 15000, percentage: 15, color: "#ffc658" },
    { name: "Others", value: 25000, percentage: 25, color: "#ff8042" }
  ]
};

type TreemapContentProps = {
  root?: object;
  depth?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  name: string;
  value: number;
  percentage: number;
  color: string;
};

interface TreeMapData {
  name: string;
  value: number;
  percentage: number;
  color: string;
}

interface LiquidityTreeMapProps {
  data: TreeMapData[];
}

const CustomizedContent: React.FC<TreemapContentProps> = (props) => {
  const { x, y, width, height, name, value, percentage, color } = props;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color,
          stroke: "#fff",
          strokeWidth: 2,
          strokeOpacity: 1
        }}
      />
      {width > 50 && height > 30 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 12}
            textAnchor="middle"
            fill="#fff"
            fontSize={14}
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 8}
            textAnchor="middle"
            fill="#fff"
            fontSize={14}
          >
            {value?.toLocaleString()} ATOM
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 24}
            textAnchor="middle"
            fill="#fff"
            fontSize={12}
          >
            ({percentage}%)
          </text>
        </>
      )}
    </g>
  );
};



const LiquidityTreeMap = ({ data }: LiquidityTreeMapProps) => {
  if (!data || data.length === 0) {
    return <div>No distribution data available</div>;
  }

  return (
    <div style={{ width: "100%", height: "400px" }}>
      <ResponsiveContainer>
        <Treemap
          data={data}
          dataKey="value"
          aspectRatio={4 / 3}
          stroke="#fff"
          fill="#8884d8"
          content={(props) => <CustomizedContent {...props} />}
        />
      </ResponsiveContainer>
    </div>
  );
};

const HydroMetrics = () => {
  const [selectedRound, setSelectedRound] = useState(1);
  const [tvl, setTvl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [liquidity, setLiquidity] = useState(null);
  const [liquidityLoading, setLiquidityLoading] = useState(true);
  const [liquidityError, setLiquidityError] = useState(null);
  const [tributeMetrics, setTributeMetrics] = useState<TributeMetrics>({
    totalTributes: 0,
    lowestTribute: 0,
    averageTribute: 0,
    highestTribute: 0,
    projectTributes: []
  });
  const [projectsData, setProjectsData] = useState<ProjectsData>({
    projects: [],
    tributesByProject: []
  });
  const [tributesLoading, setTributesLoading] = useState(true);
  const [tributesError, setTributesError] = useState(null);
  const [roundsData, setRoundsData] = useState([]);
  const [roundsLoading, setRoundsLoading] = useState(true);
  const [roundsError, setRoundsError] = useState(null);

  const getCategoryForProject = (projectName: string): string => {
    const categoryMap = {
      'Mars Protocol': 'Money Market',
      'Shade Protocol': 'DEX',
      'Stride': 'Liquid Staking',
      'Fenix Directive': 'L1',
      'White Whale': 'DEX',
      'Demex': 'DEX',
      'Neptune Finance': 'Money Market',
      'Nolus': 'Money Market',
      'Margined': 'Redemption Rate Arbitrage'
    };
    return categoryMap[projectName] || 'Other';
  };


  // TVL fetch effect
  useEffect(() => {
    const fetchTVL = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/tvl');
        const data = await response.json();
        setTvl(data.tvl);
        setError(null);
      } catch (err) {
        setError('Failed to fetch TVL data');
        console.error('Error fetching TVL:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTVL();
    const interval = setInterval(fetchTVL, 60000);
    return () => clearInterval(interval);
  }, []);

  // Liquidity fetch effect
  useEffect(() => {
    const fetchLiquidity = async () => {
      try {
        setLiquidityLoading(true);
        const response = await fetch('/api/liquidity');
        const data = await response.json();
        setLiquidity(data.liquidity);
        setLiquidityError(null);
      } catch (err) {
        setLiquidityError('Failed to fetch liquidity data');
        console.error('Error fetching liquidity:', err);
      } finally {
        setLiquidityLoading(false);
      }
    };

    fetchLiquidity();
    const interval = setInterval(fetchLiquidity, 60000);
    return () => clearInterval(interval);
  }, []);

  // Tribute metrics fetch effect
  useEffect(() => {
    const fetchTributeMetrics = async () => {
      try {
        setTributesLoading(true);
        const response = await fetch('/api/tributes');

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Transform project tributes data
        const transformedProjects = data.projectTributes.map(project => ({
          name: project.name,
          category: getCategoryForProject(project.name),
          value: project.value,
          color: project.color
        }));

        setProjectsData({
          projects: transformedProjects.map(p => ({
            name: p.name,
            category: p.category
          })),
          tributesByProject: transformedProjects
        });

        // Update tribute metrics
        setTributeMetrics({
          totalTributes: data.totalTributes,
          lowestTribute: data.lowestTribute,
          averageTribute: data.averageTribute,
          highestTribute: Math.max(...data.projectTributes.map(p => p.value)),
          projectTributes: data.projectTributes
        });

        setTributesError(null);
      } catch (err) {
        console.error('Error fetching tribute metrics:', err);
        setTributesError('Failed to fetch tribute metrics');
      } finally {
        setTributesLoading(false);
      }
    };

    fetchTributeMetrics();
    const interval = setInterval(fetchTributeMetrics, 60000);
    return () => clearInterval(interval);
  }, []);

  // Rounds data fetch effect
  useEffect(() => {
    const fetchRoundsData = async () => {
      try {
        setRoundsLoading(true);
        const response = await fetch('/api/rounds');

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setRoundsData(data.rounds || []);
        setRoundsError(null);
      } catch (err) {
        console.error('Error fetching rounds data:', err);
        setRoundsError('Failed to fetch rounds data');
      } finally {
        setRoundsLoading(false);
      }
    };

    fetchRoundsData();
    const interval = setInterval(fetchRoundsData, 60000);
    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return "No data";
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const renderMetricValue = (value, loading, error, formatter = formatCurrency) => {
    if (loading) return "Loading...";
    if (error) return "Error loading data";
    return formatter(value);
  };

  const getCurrentRoundData = () => {
    if (roundsLoading) return null;
    if (roundsError) return null;
    if (!roundsData || roundsData.length === 0) return null;
    const data = roundsData.find(r => r.round === selectedRound) || roundsData[0];
    console.log('Current Round Data:', data);  // Add this line
    return data;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="relative bg-gradient-to-br from-indigo-900 via-purple-800 to-pink-800 text-white">
        <div className="absolute inset-0 bg-grid-white/[0.05] bg-[size:20px_20px]" />
        <div className="max-w-6xl mx-auto p-8">
          <div className="relative">
            <h1 className="text-4xl font-bold mb-2">Hydro Analytics</h1>
            <p className="text-indigo-200 mb-8">Real-time metrics and insights for Hydro performance</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* First Card */}
              <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6">
                <div className="text-sm text-gray-300">Total Liquidity Exported to Projects</div>
                <div className="text-4xl font-bold mt-2">
                  {liquidityLoading ? (
                    "Loading..."
                  ) : liquidityError ? (
                    "Error loading data"
                  ) : (
                    `${((liquidity || 0) / 1_000_000).toLocaleString(undefined, {
                      minimumFractionDigits: 3,
                      maximumFractionDigits: 3
                    })} ATOM`
                  )}
                </div>
                {!liquidityLoading && !liquidityError && (
                  <div className="flex items-center text-emerald-400 text-sm mt-2">
                    <ArrowUpIcon className="w-4 h-4 mr-1" />
                    12.5% from last month
                  </div>
                )}
              </div>

              {/* Second Card */}
              <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6">
                <div className="text-sm text-gray-300">Total ATOM locked by Hydro users</div>
                <div className="text-4xl font-bold mt-2">
                  {loading ? (
                    "Loading..."
                  ) : error ? (
                    "Error loading data"
                  ) : (
                    `${((tvl || 0) / 1_000_000).toLocaleString(undefined, {
                      minimumFractionDigits: 3,
                      maximumFractionDigits: 3
                    })} ATOM`
                  )}
                </div>
                {!loading && !error && (
                  <div className="flex items-center text-emerald-400 text-sm mt-2">
                    <ArrowUpIcon className="w-4 h-4 mr-1" />
                    8.3% from last month
                  </div>
                )}
              </div>

              {/* Third Card */}
              <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6">
                <div className="text-sm text-gray-300">Total Tributes Paid</div>
                <div className="text-4xl font-bold mt-2">
                  {tributesLoading ? (
                    "Loading..."
                  ) : tributesError ? (
                    "Error loading data"
                  ) : (
                    `$${tributeMetrics.totalTributes.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}`
                  )}
                </div>
                {!tributesLoading && !tributesError && (
                  <div className="flex items-center text-emerald-400 text-sm mt-2">
                    <ArrowUpIcon className="w-4 h-4 mr-1" />
                    15.2% from last month
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8 -mt-8">
        <div className="bg-gradient-to-b from-gray-900/5 to-gray-900/10 backdrop-blur-xl rounded-xl shadow-xl p-8 border border-white/10">
          <Tabs defaultValue="rounds" className="space-y-6">
            <TabsList className="inline-flex p-1 bg-gray-100 rounded-lg w-full">
              <TabsTrigger
                value="overview"
                className="flex-1 px-6 py-2 rounded-md text-gray-600 hover:text-gray-900 data-[state=active]:bg-white data-[state=active]:text-gray-900 transition-colors"
              >
                Community Pool
              </TabsTrigger>
              <TabsTrigger
                value="rounds"
                className="flex-1 px-6 py-2 rounded-md text-gray-600 hover:text-gray-900 data-[state=active]:bg-white data-[state=active]:text-gray-900 transition-colors"
              >
                Rounds
              </TabsTrigger>
              <TabsTrigger
                value="proposals"
                className="flex-1 px-6 py-2 rounded-md text-gray-600 hover:text-gray-900 data-[state=active]:bg-white data-[state=active]:text-gray-900 transition-colors"
              >
                Bids
              </TabsTrigger>
              <TabsTrigger
                value="voters"
                className="flex-1 px-6 py-2 rounded-md text-gray-600 hover:text-gray-900 data-[state=active]:bg-white data-[state=active]:text-gray-900 transition-colors"
              >
                Voters
              </TabsTrigger>
            </TabsList>

            <TabsContent value="rounds">
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-800">Round Details</h2>
                  <Select
                    value={selectedRound?.toString() || "1"}  // Default to "1" if no round selected
                    onValueChange={(value) => setSelectedRound(Number(value))}
                  >
                    <SelectTrigger className="w-52">
                      <SelectValue placeholder="Select Round" />
                    </SelectTrigger>
                    <SelectContent>
                      {roundsLoading ? (
                        <div className="p-2 text-center text-gray-500">Loading rounds...</div>
                      ) : roundsError ? (
                        <div className="p-2 text-center text-red-500">Error loading rounds</div>
                      ) : roundsData?.length > 0 ? (
                        roundsData.map((round) => (
                          <SelectItem key={round.round} value={round.round.toString()}>
                            Round {round.round}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="p-2 text-center text-gray-500">No rounds available</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                        <span>Available ATOM liquidity for bids</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-gray-900">
                        {roundsLoading ? "Loading..." :
                          roundsError ? "Error loading data" :
                            getCurrentRoundData()?.trancheSize ?
                              `${getCurrentRoundData().trancheSize.toLocaleString()} ATOM` :
                              "No data available"}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Total Tributes Card */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-purple-500"></span>
                        <span>Total Tributes</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-gray-900">
                        {roundsLoading ? "Loading..." :
                          roundsError ? "Error loading data" :
                            getCurrentRoundData()?.tributesPaid ?
                              `$${getCurrentRoundData().tributesPaid.toLocaleString()}` :
                              "No data available"}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Projects Card */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                        <span>Projects</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-gray-900">
                        {roundsLoading ? "Loading..." :
                          roundsError ? "Error loading data" :
                            getCurrentRoundData()?.projectsParticipated ?
                              getCurrentRoundData().projectsParticipated :
                              "No data available"}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden">
                  <CardHeader className="border-b border-gray-100 bg-gray-50/50 pb-2">
                    <CardTitle className="flex items-center space-x-2">
                      <span className="h-2 w-2 rounded-full bg-purple-500"></span>
                      <span className="text-sm font-medium text-gray-600">Liquidity Distribution amongst winning projects</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    {roundsLoading ? (
                      <div className="text-center py-8">Loading...</div>
                    ) : roundsError ? (
                      <div className="text-center py-8 text-red-500">Error loading data</div>
                    ) : getCurrentRoundData()?.liquidityWon ? (
                      <LiquidityTreeMap data={getCurrentRoundData().liquidityWon} />
                    ) : (
                      <div className="text-center py-8">No distribution data available</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="overview">
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-800">Community Pool</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                        <span>Total Revenue Accrued by Community Pool</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-gray-900">
                        {overviewData.totalRevenue.toLocaleString()} ATOM
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-purple-500"></span>
                        <span>Community Pool APR</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-gray-900">
                        {overviewData.communityPoolAPR}%
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden">
                  <CardHeader className="border-b border-gray-100 bg-gray-50/50 pb-2">
                    <CardTitle className="flex items-center space-x-2">
                      <span className="h-2 w-2 rounded-full bg-purple-500"></span>
                      <span className="text-sm font-medium text-gray-600">Contribution to Community Pool Revenue per Project</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <LiquidityTreeMap data={overviewData.ProjectsQuotatoCommunityPoolRevenue} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="proposals">
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {/* Lowest Tribute Card */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-red-500"></span>
                        <span>Lowest Tribute Paid</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        {renderMetricValue(
                          tributeMetrics.lowestTribute,
                          tributesLoading,
                          tributesError,
                          (value) => `$${formatCurrency(value)}`
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Average Tribute Card */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
                        <span>Average Tribute Paid</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        {renderMetricValue(
                          tributeMetrics.averageTribute,
                          tributesLoading,
                          tributesError,
                          (value) => `$${formatCurrency(value)}`
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Highest Tribute Card */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-green-500"></span>
                        <span>Highest Tribute Paid</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        {renderMetricValue(
                          tributeMetrics.highestTribute,
                          tributesLoading,
                          tributesError,
                          (value) => `$${formatCurrency(value)}`
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                  {/* Projects List */}
                  <div className="col-span-2">
                    <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300 h-full">
                      <CardHeader className="border-b border-gray-100 bg-gray-50/50">
                        <CardTitle className="text-lg font-medium text-gray-800">Projects List</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="divide-y divide-gray-100 overflow-auto" style={{ height: '350px' }}>
                          {projectsData.projects.map((project, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between p-4 hover:bg-gradient-to-r hover:from-purple-50 hover:to-indigo-50 transition-all duration-200"
                            >
                              <div className="font-medium text-gray-900 flex items-center">
                                <span className="h-2 w-2 rounded-full bg-indigo-500 mr-2"></span>
                                {project.name}
                              </div>
                              <div className="text-sm font-medium px-3 py-1 rounded-full"
                                style={{
                                  backgroundColor: (() => {
                                    switch (project.category) {
                                      case 'DEX': return '#EEF2FF';
                                      case 'Liquid Staking': return '#F0FDF4';
                                      case 'L1': return '#FEF3F2';
                                      case 'Money Market': return '#FFF7ED';
                                      case 'Redemption Rate Arbitrage': return '#F5F3FF';
                                      default: return '#F8FAFC';
                                    }
                                  })(),
                                  color: (() => {
                                    switch (project.category) {
                                      case 'DEX': return '#4F46E5';
                                      case 'Liquid Staking': return '#16A34A';
                                      case 'L1': return '#DC2626';
                                      case 'Money Market': return '#EA580C';
                                      case 'Redemption Rate Arbitrage': return '#EA580C';
                                      default: return '#475569';
                                    }
                                  })()
                                }}
                              >
                                {project.category}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>


                  {/* Tributes Pie Chart */}
                  <div className="col-span-3">
                    <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                      <CardHeader className="border-b border-gray-100 bg-gray-50/50">
                        <CardTitle className="text-lg font-medium text-gray-800">Total Tributes by Project</CardTitle>
                      </CardHeader>
                      <CardContent className="p-6">
                        <div style={{ width: '100%', height: '350px' }}>
                          <ResponsiveContainer>
                            <PieChart>
                              <Pie
                                data={projectsData.tributesByProject}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius={120}
                                fill="#8884d8"
                              >
                                {projectsData.tributesByProject.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                              <Legend
                                layout="vertical"
                                align="right"
                                verticalAlign="middle"
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>

            </TabsContent>

            <TabsContent value="voters">
              <div className="space-y-6">
                {/* First Row - 2 Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {/* Total Number of Voters */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                        <span>Number of active Hydro users</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        1,245
                      </div>
                    </CardContent>
                  </Card>

                  {/* Max Locked ATOM */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-purple-500"></span>
                        <span>Cap on ATOM locked per user</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        200 ATOM
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Second Row - 3 Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Average Voting Power */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                        <span>Average ATOM locked ( VP) per user</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        300 ATOM ( 1%)
                      </div>
                    </CardContent>
                  </Card>

                  {/* Active Voters Ratio */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                        <span>Percentage of active voting users</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        85%
                      </div>
                    </CardContent>
                  </Card>

                  {/* Average APR per Voter */}
                  <Card className="bg-gradient-to-br from-white to-gray-50 border-0 shadow-md hover:shadow-lg transition-all duration-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center space-x-2 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
                        <span>Average APR per Voter</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-gray-900">
                        7%
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default HydroMetrics;