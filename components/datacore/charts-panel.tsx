'use client';

import { useIntel } from '@/contexts/intel-context';
import { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    LineChart, Line,
} from 'recharts';

const COLORS = ['#ef4444', '#06b6d4', '#f97316', '#ec4899', '#10b981', '#8b5cf6', '#eab308', '#f87171', '#22c55e', '#3b82f6'];

const tooltipStyle = {
    background: '#1e293b',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    borderRadius: 8,
    fontSize: 11,
    color: '#f1f5f9',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
};

const tooltipLabelStyle = { color: '#94a3b8', fontWeight: 600, marginBottom: 4 };
const tooltipItemStyle = { color: '#f1f5f9' };

function ChartCard({ title, children, minHeight = 2 }: { title: string; children: React.ReactNode; minHeight?: number }) {
    return (
        <div className="bg-slate-800/60 border border-slate-600/20 rounded-lg p-2 flex flex-col">
            <h3 className="text-cyan-400 text-[9px] font-bold tracking-widest uppercase mb-1">{title}</h3>
            <div className="flex-1" style={{ minHeight }}>{children}</div>
        </div>
    );
}

export default function ChartsPanel() {
    const { stats, isDataLoaded } = useIntel();

    const data = useMemo(() => {
        if (!stats) return null;

        const truncName = (items: { name: string; count: number }[], maxLen: number, limit: number) =>
            (items ?? []).slice(0, limit).map(item => ({
                name: item.name.length > maxLen ? item.name.substring(0, maxLen) + '...' : item.name,
                fullName: item.name,
                value: item.count,
            }));

        const timeline = (stats.timeline ?? []).map(t => ({ name: t.fecha, value: t.count }));

        return {
            tipologias: truncName(stats.tipologias, 24, 10),
            municipios: truncName(stats.municipios, 13, 10),
            fenomenos: truncName(stats.fenomenos, 10, 10),
            fenomenoRadar: truncName(stats.fenomenos, 30, 15),
            departamentos: truncName(stats.departamentos, 22, 15),
            timeline,
        };
    }, [stats]);

    if (!isDataLoaded || !data) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1 p-1">
            <ChartCard title="Desglose por Tipologia" minHeight={Math.max(250, data.tipologias.length * 20)}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.tipologias} layout="vertical" margin={{ left: 10, right: 10, top: 0, bottom: 0 }}>
                        <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 7, fill: '#cbd5e1' }} tickLine={false} width={120} />
                        <Tooltip
                            contentStyle={tooltipStyle}
                            labelStyle={tooltipLabelStyle}
                            itemStyle={tooltipItemStyle}
                            labelFormatter={(label, payload) =>
                                payload?.[0]?.payload?.fullName ?? label
                            }
                            formatter={(value: any) => [value.toLocaleString(), "Casos"]}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                            {data.tipologias.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Municipio" minHeight={250}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.municipios} margin={{ left: 5, right: 5, top: 0, bottom: 20 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 7, fill: '#cbd5e1' } as any} tickLine={false} height={40} interval={0} angle={-45} />
                        <YAxis tick={{ fontSize: 7, fill: '#94a3b8' }} tickLine={false} />
                        <Tooltip
                            contentStyle={tooltipStyle}
                            labelStyle={tooltipLabelStyle}
                            itemStyle={tooltipItemStyle}
                            labelFormatter={(label, payload) =>
                                payload?.[0]?.payload?.fullName ?? label
                            }
                            formatter={(value: any) => [value.toLocaleString(), "Casos"]}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {data.municipios.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Fenomeno Criminalidad" minHeight={280}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={data.fenomenos} cx="50%" cy="50%" outerRadius={65} innerRadius={30} dataKey="value"
                            label={({ name, percent }: any) => `${(name ?? '').substring(0, 10)} ${((percent ?? 0) * 100).toFixed(0)}%`}
                            labelLine={false} style={{ fontSize: 7 }}>
                            {data.fenomenos.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
                            formatter={(value: any, name: any, props: any) => [value.toLocaleString(), props?.payload?.fullName ?? 'Casos']} />
                    </PieChart>
                </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Analisis Radar Fenomenos" minHeight={280}>
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={data.fenomenoRadar} cx="50%" cy="50%" outerRadius={65}>
                        <PolarGrid stroke="#06d428" />
                        <PolarAngleAxis dataKey="name" tick={{ fontSize: 7, fill: '#cbd5e1' }} />
                        <PolarRadiusAxis tick={{ fontSize: 7, fill: '#94a3b8' }} />
                        <Radar name="Casos" dataKey="value" stroke="#f7eb05" fill="#f7eb05" fillOpacity={0.3} />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
                            formatter={(value: any) => [value.toLocaleString(), 'Casos']} />
                    </RadarChart>
                </ResponsiveContainer>
            </ChartCard>

            <div className="md:col-span-2 xl:col-span-4">
                <ChartCard title="Linea Temporal de Incidentes">
                    <ResponsiveContainer width="100%" height={60}>
                        <LineChart data={data.timeline} margin={{ left: 5, right: 5, top: 0, bottom: 15 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 8, fill: '#cbd5e1' } as any} tickLine={false} height={35} interval="preserveStartEnd" angle={-45} />
                            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} />
                            <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
                                formatter={(value: any) => [value.toLocaleString(), 'Eventos']} />
                            <Line type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444', r: 2 }} activeDot={{ r: 4, fill: '#ef4444' }} />
                        </LineChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>
        </div>
    );
}
