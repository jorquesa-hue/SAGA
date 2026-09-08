/**
 * Small dense linear algebra, written out rather than pulled from a library
 * because this package must stay dependency-free: the same code runs in the
 * API, in the edge gateway on a farm, and in tests, and a native BLAS binding
 * would break at least one of those.
 *
 * Everything here is deterministic and allocation-modest. Matrices are plain
 * row-major `number[][]`; vectors are `number[]`.
 */

/** A square symmetric matrix's eigen-decomposition, eigenvalues ascending. */
export interface Eigen {
  /** Eigenvalues, ascending. */
  values: number[];
  /** `vectors[i]` is the unit eigenvector for `values[i]`. */
  vectors: number[][];
}

/**
 * Cyclic Jacobi eigen-decomposition of a real symmetric matrix.
 *
 * Chosen over inverse power iteration because we specifically need the
 * eigenvector of the *smallest* eigenvalue of a near-singular matrix (the
 * homography null-space), which is exactly where power iteration is least
 * stable. Jacobi is unconditionally stable for symmetric input and yields the
 * whole spectrum, which we reuse as a free degeneracy diagnostic.
 */
export function jacobiEigen(input: readonly number[][], maxSweeps = 100): Eigen {
  const n = input.length;
  const a = input.map((row) => [...row]);
  // v accumulates the rotations, so its columns end up as the eigenvectors.
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Convergence test: the sum of squared off-diagonal magnitude.
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) off += a[i]![j]! * a[i]![j]!;
    }
    if (off <= 1e-30) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        // Standard Jacobi rotation angle; the `t` form below is the numerically
        // stable root of t^2 + 2*theta*t - 1 = 0.
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({
    value: a[i]![i]!,
    vector: v.map((row) => row[i]!),
  }));
  pairs.sort((x, y) => x.value - y.value);
  return {
    values: pairs.map((p) => p.value),
    vectors: pairs.map((p) => p.vector),
  };
}

/**
 * Solve `A x = b` for symmetric positive-definite `A` by Cholesky.
 * Returns null when `A` is not positive definite, which the callers treat as
 * "this configuration is degenerate", never as a value to paper over.
 */
export function choleskySolve(
  a: readonly number[][],
  b: readonly number[],
): number[] | null {
  const n = a.length;
  const l: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i]![j]!;
      for (let k = 0; k < j; k++) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (!(sum > 0) || !Number.isFinite(sum)) return null;
        l[i]![j] = Math.sqrt(sum);
      } else {
        l[i]![j] = sum / l[j]![j]!;
      }
    }
  }

  // Forward substitution: L y = b.
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= l[i]![k]! * y[k]!;
    y[i] = sum / l[i]![i]!;
  }
  // Back substitution: L^T x = y.
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= l[k]![i]! * x[k]!;
    x[i] = sum / l[i]![i]!;
  }
  return x;
}

/** Matrix product. */
export function matMul(a: readonly number[][], b: readonly number[][]): number[][] {
  const n = a.length;
  const m = b[0]!.length;
  const inner = b.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = a[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < m; j++) out[i]![j] = out[i]![j]! + aik * b[k]![j]!;
    }
  }
  return out;
}

/** Inverse of a 3x3 matrix, or null when effectively singular. */
export function invert3(m: readonly number[][]): number[][] | null {
  const [a, b, c] = [m[0]![0]!, m[0]![1]!, m[0]![2]!];
  const [d, e, f] = [m[1]![0]!, m[1]![1]!, m[1]![2]!];
  const [g, h, i] = [m[2]![0]!, m[2]![1]!, m[2]![2]!];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

/** Median of a numeric sample. Does not mutate the input. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Median absolute deviation, scaled to be a consistent estimator of the
 * standard deviation for Gaussian data. Used instead of the sample standard
 * deviation wherever a single bad frame could otherwise dominate.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}
