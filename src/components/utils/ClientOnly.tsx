"use client"

import { useEffect, useState } from "react"
import { LoadingChart } from "../ui/loading-chart"

type ClientOnlyProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ClientOnly({ children, fallback = <LoadingChart /> }: ClientOnlyProps) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  return isClient ? children : fallback
}