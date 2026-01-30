import { useCATE } from '@/lib/CATEContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Play, Square, Activity } from 'lucide-react'
import { AssetSymbol } from '@/lib/oracleReal'

const ASSETS: { value: AssetSymbol; label: string }[] = [
  { value: 'SOL', label: 'SOL/USD' },
  { value: 'BTC', label: 'BTC/USD' },
  { value: 'ETH', label: 'ETH/USD' },
  { value: 'JUP', label: 'JUP/USD' },
  { value: 'BONK', label: 'BONK/USD' },
  { value: 'PYTH', label: 'PYTH/USD' },
]

export function ControlPanel() {
  const { 
    isRunning, 
    isLoading, 
    startEngine, 
    stopEngine, 
    evaluateAndSign,
    selectedAsset,
    changeAsset 
  } = useCATE()

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-400">
          <Activity className="h-4 w-4" />
          Control Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Engine Status</span>
          <Badge 
            variant={isRunning ? "default" : "secondary"}
            className={isRunning ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-slate-700 text-slate-400"}
          >
            {isRunning ? 'RUNNING' : 'STOPPED'}
          </Badge>
        </div>

        {/* Seletor de Token */}
        <div className="space-y-2">
          <label className="text-xs text-slate-500">Asset</label>
          <select 
            value={selectedAsset}
            onChange={(e) => changeAsset(e.target.value as AssetSymbol)}
            disabled={isRunning}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {ASSETS.map(asset => (
              <option key={asset.value} value={asset.value}>
                {asset.label}
              </option>
            ))}
          </select>
        </div>

        {/* Botões de Controle */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={startEngine}
            disabled={isRunning || isLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Play className="h-4 w-4 mr-2" />
            Start
          </Button>
          <Button
            onClick={stopEngine}
            disabled={!isRunning}
            variant="destructive"
          >
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        </div>

        {/* Botão de Simulação */}
        <Button
          onClick={evaluateAndSign}
          disabled={!isRunning || isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Activity className="h-4 w-4 mr-2" />
          Simulate {selectedAsset}/USD
        </Button>
      </CardContent>
    </Card>
  )
}
