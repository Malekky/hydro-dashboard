"use client"

import React from 'react'

export const LoadingChart = () => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-[300px] bg-slate-50 rounded-lg animate-pulse">
      <div className="w-10 h-10 border-4 border-gray-200 rounded-full border-t-blue-500 animate-spin"></div>
      <p className="mt-4 text-sm text-gray-500">Loading chart data...</p>
    </div>
  );
};