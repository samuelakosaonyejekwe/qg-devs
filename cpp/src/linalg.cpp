#include "qgdevs/linalg.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <numeric>
#include <stdexcept>

namespace qgdevs {

void eigh(const CMat& A0, std::vector<double>& w, CMat* Vout) {
    const int n = A0.rows();
    if (A0.cols() != n) throw std::invalid_argument("eigh: matrix not square");
    CMat A(n, n);
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j) A(i, j) = 0.5 * (A0(i, j) + std::conj(A0(j, i)));
    const bool want_v = Vout != nullptr;
    CMat V = want_v ? CMat::identity(n) : CMat();

    double frob2 = 0.0;
    for (std::size_t k = 0; k < A.size(); ++k) frob2 += std::norm(A.data()[k]);
    const double tiny = 1e-300;

    for (int sweep = 0; sweep < 100; ++sweep) {
        double off2 = 0.0;
        for (int p = 0; p < n; ++p)
            for (int q = p + 1; q < n; ++q) off2 += std::norm(A(p, q));
        // Converged when the off-diagonal mass is below round-off of the matrix norm.
        if (off2 <= 1e-34 * frob2 || off2 < tiny) break;

        for (int p = 0; p < n - 1; ++p)
            for (int q = p + 1; q < n; ++q) {
                const cplx apq = A(p, q);
                const double r = std::sqrt(std::norm(apq));  // |a_pq| without the slower hypot
                if (r < tiny) continue;
                const double app = A(p, p).real(), aqq = A(q, q).real();
                // Skip rotations that would not change the diagonal at working precision.
                if (sweep > 3 && std::abs(app) + 1e3 * r == std::abs(app) &&
                    std::abs(aqq) + 1e3 * r == std::abs(aqq)) {
                    A(p, q) = 0.0;
                    A(q, p) = 0.0;
                    continue;
                }
                const cplx ph = apq / r;  // e^{iφ}
                const double theta = (aqq - app) / (2.0 * r);
                const double t = (theta >= 0 ? 1.0 : -1.0) / (std::abs(theta) + std::sqrt(theta * theta + 1.0));
                const double c = 1.0 / std::sqrt(t * t + 1.0), s = t * c;
                // J = [[c, s], [-s e^{-iφ}, c e^{-iφ}]] on columns (p, q); A <- J† A J, V <- V J.
                const cplx phc = std::conj(ph);
                const cplx j00 = c, j01 = s, j10 = -s * phc, j11 = c * phc;
                for (int k = 0; k < n; ++k) {  // columns
                    const cplx akp = A(k, p), akq = A(k, q);
                    A(k, p) = akp * j00 + akq * j10;
                    A(k, q) = akp * j01 + akq * j11;
                }
                if (want_v)
                    for (int k = 0; k < n; ++k) {
                        const cplx vkp = V(k, p), vkq = V(k, q);
                        V(k, p) = vkp * j00 + vkq * j10;
                        V(k, q) = vkp * j01 + vkq * j11;
                    }
                for (int k = 0; k < n; ++k) {  // rows: J† A
                    const cplx apk = A(p, k), aqk = A(q, k);
                    A(p, k) = std::conj(j00) * apk + std::conj(j10) * aqk;
                    A(q, k) = std::conj(j01) * apk + std::conj(j11) * aqk;
                }
                A(p, q) = 0.0;
                A(q, p) = 0.0;
                A(p, p) = A(p, p).real();
                A(q, q) = A(q, q).real();
            }
    }

    std::vector<int> idx(n);
    std::iota(idx.begin(), idx.end(), 0);
    std::sort(idx.begin(), idx.end(), [&](int a, int b) { return A(a, a).real() < A(b, b).real(); });
    w.resize(n);
    for (int k = 0; k < n; ++k) w[k] = A(idx[k], idx[k]).real();
    if (Vout) {
        *Vout = CMat(n, n);
        for (int k = 0; k < n; ++k)
            for (int i = 0; i < n; ++i) (*Vout)(i, k) = V(i, idx[k]);
    }
}

std::vector<double> eigvalsh(const CMat& A) {
    std::vector<double> w;
    eigh(A, w, nullptr);
    return w;
}

std::vector<double> singular_values(const CMat& A0) {
    CMat A = A0;
    const int m = A.rows(), n = A.cols();
    const double eps = 1e-15;
    for (int sweep = 0; sweep < 100; ++sweep) {
        bool rotated = false;
        for (int p = 0; p < n - 1; ++p)
            for (int q = p + 1; q < n; ++q) {
                double alpha = 0.0, beta = 0.0;
                cplx gamma = 0.0;
                for (int k = 0; k < m; ++k) {
                    alpha += std::norm(A(k, p));
                    beta += std::norm(A(k, q));
                    gamma += std::conj(A(k, p)) * A(k, q);
                }
                const double g = std::sqrt(std::norm(gamma));
                if (g == 0.0 || g <= eps * std::sqrt(alpha * beta)) continue;
                rotated = true;
                const cplx phc = std::conj(gamma / g);
                const double theta = (beta - alpha) / (2.0 * g);
                const double t = (theta >= 0 ? 1.0 : -1.0) / (std::abs(theta) + std::sqrt(theta * theta + 1.0));
                const double c = 1.0 / std::sqrt(t * t + 1.0), s = t * c;
                for (int k = 0; k < m; ++k) {
                    const cplx ap = A(k, p), aq = A(k, q);
                    A(k, p) = c * ap - s * phc * aq;
                    A(k, q) = s * ap + c * phc * aq;
                }
            }
        if (!rotated) break;
    }
    std::vector<double> sv(n);
    for (int j = 0; j < n; ++j) {
        double s2 = 0.0;
        for (int k = 0; k < m; ++k) s2 += std::norm(A(k, j));
        sv[j] = std::sqrt(s2);
    }
    std::sort(sv.begin(), sv.end(), std::greater<double>());
    return sv;
}

CMat sqrtm_psd(const CMat& A) {
    std::vector<double> w;
    CMat V;
    eigh(A, w, &V);
    const int n = A.rows();
    CMat S(n, n);
    for (int k = 0; k < n; ++k) {
        const double s = std::sqrt(std::max(w[k], 0.0));
        if (s == 0.0) continue;
        for (int i = 0; i < n; ++i) {
            const cplx vis = V(i, k) * s;
            for (int j = 0; j < n; ++j) S(i, j) += vis * std::conj(V(j, k));
        }
    }
    return S;
}

}  // namespace qgdevs
