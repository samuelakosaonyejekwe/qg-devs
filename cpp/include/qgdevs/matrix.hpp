// Small dense complex matrices (row-major, std::complex<double>; memory layout matches numpy complex128).
#pragma once

#include <complex>
#include <cstddef>
#include <vector>

namespace qgdevs {

using cplx = std::complex<double>;

class CMat {
public:
    CMat() = default;
    CMat(int rows, int cols) : r_(rows), c_(cols), a_(static_cast<std::size_t>(rows) * cols) {}
    static CMat identity(int n);
    static CMat from_data(int rows, int cols, const cplx* src);

    int rows() const { return r_; }
    int cols() const { return c_; }
    std::size_t size() const { return a_.size(); }
    cplx* data() { return a_.data(); }
    const cplx* data() const { return a_.data(); }
    cplx& operator()(int i, int j) { return a_[static_cast<std::size_t>(i) * c_ + j]; }
    const cplx& operator()(int i, int j) const { return a_[static_cast<std::size_t>(i) * c_ + j]; }

    CMat adjoint() const;
    CMat conjugate() const;
    cplx trace() const;
    void set_zero();

    CMat& operator+=(const CMat& o);
    CMat& operator-=(const CMat& o);
    CMat& operator*=(cplx s);

private:
    int r_ = 0, c_ = 0;
    std::vector<cplx> a_;
};

CMat operator*(const CMat& A, const CMat& B);
CMat operator+(CMat A, const CMat& B);
CMat operator-(CMat A, const CMat& B);
CMat operator*(cplx s, CMat A);

// C = A B (C preallocated, must not alias A or B).
void matmul(const CMat& A, const CMat& B, CMat& C);
// C = A B† (C preallocated, must not alias).
void matmul_adj(const CMat& A, const CMat& B, CMat& C);
CMat kron(const CMat& A, const CMat& B);
double max_abs_diff(const CMat& A, const CMat& B);
double hermiticity_error(const CMat& A);  // max |A - A†|

}  // namespace qgdevs
