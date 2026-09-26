import React from 'react';
import {
  ShieldCheck,
  Server,
  Layers,
  CheckCircle2,
  FileText,
  Lock,
  Smartphone,
  Terminal,
} from 'lucide-react';

export default function HomePage() {
  const readinessItems = [
    {
      title: 'Next.js 15 & React 19',
      status: 'Configurado',
      desc: 'App Router moderno, TypeScript estrito e scripts de build/lint validados.',
      icon: <Terminal size={20} color="#38bdf8" />,
    },
    {
      title: 'Supabase SSR & Client',
      status: 'Pronto',
      desc: 'Clientes desacoplados para Browser e Server. Service role estritamente blindada contra o frontend.',
      icon: <Server size={20} color="#34d399" />,
    },
    {
      title: 'Políticas de Segurança e RLS',
      status: 'Ativo',
      desc: 'Diretrizes de RLS inabaláveis conforme SECURITY.md e PROJECT_RULES.md.',
      icon: <ShieldCheck size={20} color="#818cf8" />,
    },
    {
      title: 'PWA & Estratégia Offline',
      status: 'Instalável',
      desc: 'Manifest PWA e Service Worker inicial preparados sob premissa de consistência estrita.',
      icon: <Smartphone size={20} color="#f472b6" />,
    },
    {
      title: 'Arquitetura Multi-tenant',
      status: 'Planejado',
      desc: 'Estrutura de diretórios e tabelas conceituais alinhadas para isolamento total.',
      icon: <Layers size={20} color="#fbbf24" />,
    },
    {
      title: 'Governança & Docs',
      status: 'Auditado',
      desc: 'Regras mapeadas em /docs como única fonte da verdade com PROJECT_RULES.md e AGENTS.md.',
      icon: <FileText size={20} color="#a78bfa" />,
    },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '3rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 10%, #172554 0%, #0a0e17 70%)',
      }}
    >
      <div
        style={{
          maxWidth: '920px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '2.5rem',
        }}
      >
        {/* Header */}
        <header style={{ textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(37, 99, 235, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              marginBottom: '1.25rem',
            }}
          >
            <CheckCircle2 size={16} color="#60a5fa" />
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#93c5fd',
                letterSpacing: '0.04em',
              }}
            >
              FASE 0 — PREPARAÇÃO TÉCNICA CONCLUÍDA
            </span>
          </div>

          <h1
            style={{
              fontSize: 'clamp(2rem, 5vw, 2.75rem)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginBottom: '0.75rem',
              background: 'linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Sistema de Controle de Refeições
          </h1>
          <p
            style={{
              color: '#9ca3af',
              fontSize: '1.1rem',
              maxWidth: '650px',
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            Fundação técnica e arquitetural inicial estabelecida em estrita conformidade com os
            documentos de referência em <code>/docs</code>.
          </p>
        </header>

        {/* Status Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1.25rem',
          }}
        >
          {readinessItems.map((item, idx) => (
            <div
              key={idx}
              className="glass-panel"
              style={{
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                transition: 'transform 0.2s ease, border-color 0.2s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    padding: '8px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  }}
                >
                  {item.icon}
                </div>
                <span className="badge-tag badge-success">{item.status}</span>
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#f3f4f6' }}>
                {item.title}
              </h3>
              <p
                style={{
                  fontSize: '0.875rem',
                  color: '#9ca3af',
                  lineHeight: 1.5,
                }}
              >
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Footer / Next Step Banner */}
        <div
          className="glass-panel"
          style={{
            padding: '1.5rem 2rem',
            borderLeft: '4px solid #2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Lock size={24} color="#60a5fa" />
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f3f4f6' }}>
                Próximo Passo: Sprint 1 — Fundação SaaS e Branding
              </h4>
              <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                Aguardando conferência do usuário da estrutura base antes de criar migrations e
                layouts.
              </p>
            </div>
          </div>
          <span className="badge-tag badge-neutral">Homologação Pendente</span>
        </div>
      </div>
    </div>
  );
}
