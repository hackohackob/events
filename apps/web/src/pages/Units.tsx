import React from "react";
import Layout from "../components/Layout";
import { useUnits } from "../hooks/useUnits";

export default function UnitsPage() {
  const { data = [], isLoading } = useUnits();

  return (
    <Layout>
      <div className="hero-band">
        <div className="breadcrumb"><strong>Units</strong></div>
      </div>

      <section className="page-panel">
        <div className="panel-heading">
          <h2>Response Units</h2>
          <span>{isLoading ? "Loading..." : `${data.length} units`}</span>
        </div>
        <div className="unit-grid">
          {data.map((unit) => (
            <article className="unit-card" key={unit.id}>
              <img src={unit.avatarUrl} alt="" />
              <div>
                <strong>{unit.unitNumber} · {unit.name}</strong>
                <span>{unit.vehicle}</span>
              </div>
              <span className={`status-pill ${unit.status}`}>{unit.status}</span>
            </article>
          ))}
        </div>
      </section>
    </Layout>
  );
}
