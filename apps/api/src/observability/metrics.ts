export interface MetricDimension {
  Name: string;
  Value: string;
}

export interface MetricEmitter {
  emit(
    namespace: string,
    metricName: string,
    value: number,
    unit: 'Count' | 'Milliseconds' | 'None',
    dimensions?: MetricDimension[]
  ): void;
}

export class CloudWatchEmfMetricEmitter implements MetricEmitter {
  emit(
    namespace: string,
    metricName: string,
    value: number,
    unit: 'Count' | 'Milliseconds' | 'None',
    dimensions?: MetricDimension[]
  ): void {
    const dimensionNames = (dimensions ?? []).map((d) => d.Name);
    const dimensionValues: Record<string, string> = {};
    for (const d of dimensions ?? []) {
      dimensionValues[d.Name] = d.Value;
    }

    const emf = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: dimensionNames.length > 0 ? [dimensionNames] : [[]],
            Metrics: [
              {
                Name: metricName,
                Unit: unit
              }
            ]
          }
        ]
      },
      ...dimensionValues,
      [metricName]: value
    };

    process.stdout.write(JSON.stringify(emf) + '\n');
  }
}

export class InMemoryMetricEmitter implements MetricEmitter {
  readonly metrics: Array<{
    namespace: string;
    metricName: string;
    value: number;
    unit: string;
    dimensions?: MetricDimension[];
  }> = [];

  emit(
    namespace: string,
    metricName: string,
    value: number,
    unit: 'Count' | 'Milliseconds' | 'None',
    dimensions?: MetricDimension[]
  ): void {
    this.metrics.push({ namespace, metricName, value, unit, dimensions });
  }
}
