import React from "react";
import Layout from "../components/Layout";

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <Layout>
      <div className="hero-band">
        <div className="breadcrumb"><strong>{title}</strong></div>
      </div>
      <section className="page-panel empty-state">
        <h2>{title}</h2>
        <p>This page is connected from the navigation and ready for the next workflow.</p>
      </section>
    </Layout>
  );
}
