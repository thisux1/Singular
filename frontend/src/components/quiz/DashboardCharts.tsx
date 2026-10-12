import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { QuizPerSubjectStat } from '../../api/quiz';
import './DashboardCharts.css';

/* Cores do tema — DESIGN-BRIEF: charts 100% nos tokens, sem defaults recharts. */
const THEME = {
  ok: '#22C55E',
  fail: '#EF4444',
  blank: '#3A3A42',
  flare: '#E36002' /* TODO token (--accent-flare) */,
  warn: '#FACC15' /* TODO token (--signal-warn) */,
  track: '#18181D',
  grid: 'rgba(255, 255, 255, 0.06)',
  text: '#8A8A93',
};

type DashboardChartsProps = {
  correct: number;
  wrong: number;
  blank: number;
  perSubject: QuizPerSubjectStat[];
};

type TooltipPayloadItem = {
  name?: string;
  value?: number | string;
  payload?: Record<string, unknown>;
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const item = payload[0];
  const raw = item?.payload ?? {};

  return (
    <div className="dashboard-charts__tooltip">
      <span className="dashboard-charts__tooltip-label">{item?.name ?? (raw['subject'] as string)}</span>
      {typeof raw['total'] === 'number' ? (
        <span className="dashboard-charts__tooltip-value">
          {String(raw['correct'])}/{String(raw['total'])} acertos · {String(raw['percent'])}%
        </span>
      ) : (
        <span className="dashboard-charts__tooltip-value">{String(item?.value ?? '')}</span>
      )}
    </div>
  );
}

export function DashboardCharts({ correct, wrong, blank, perSubject }: DashboardChartsProps) {
  const donutData = [
    { name: 'Acertos', value: correct, color: THEME.ok },
    { name: 'Erros', value: wrong, color: THEME.fail },
    { name: 'Em branco', value: blank, color: THEME.blank },
  ].filter((slice) => slice.value > 0);

  const subjectData = perSubject.map((stat) => ({
    subject: stat.subject,
    correct: stat.correct,
    total: stat.total,
    percent: stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
  }));

  const showRadar = subjectData.length >= 3;

  return (
    <div className="dashboard-charts">
      <div className="dashboard-charts__panel">
        <h3 className="dashboard-charts__panel-title">Distribuição de Vetores</h3>
        <div className="dashboard-charts__donut-wrap">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="name"
                innerRadius={62}
                outerRadius={88}
                paddingAngle={3}
                strokeWidth={0}
                isAnimationActive
              >
                {donutData.map((slice) => (
                  <Cell key={slice.name} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="dashboard-charts__donut-legend">
            {donutData.map((slice) => (
              <span key={slice.name} className="dashboard-charts__legend-item">
                <span className="dashboard-charts__legend-dot" style={{ background: slice.color }} />
                {slice.name} — {slice.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="dashboard-charts__panel dashboard-charts__panel--bars">
        <h3 className="dashboard-charts__panel-title">Precisão por Disciplina</h3>
        {subjectData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(160, subjectData.length * 44)}>
            <BarChart data={subjectData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(value: number) => `${value}%`}
                tick={{ fill: THEME.text, fontSize: 11, fontFamily: 'Geist Mono, monospace' }}
                axisLine={{ stroke: THEME.grid }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="subject"
                width={130}
                tick={{ fill: THEME.text, fontSize: 11, fontFamily: 'Geist Mono, monospace' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="percent" name="Acerto" fill={THEME.flare} barSize={14} radius={0} background={{ fill: THEME.track }} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="dashboard-charts__empty">Sem dados de disciplina nesta sessão.</p>
        )}
      </div>

      {showRadar ? (
        <div className="dashboard-charts__panel">
          <h3 className="dashboard-charts__panel-title">Perfil de Cobertura</h3>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={subjectData} outerRadius="72%">
              <PolarGrid stroke={THEME.grid} />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: THEME.text, fontSize: 10, fontFamily: 'Geist Mono, monospace' }}
              />
              <Radar
                dataKey="percent"
                name="Acerto %"
                stroke={THEME.warn}
                fill={THEME.warn}
                fillOpacity={0.18}
                isAnimationActive
              />
              <Tooltip content={<ChartTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}
