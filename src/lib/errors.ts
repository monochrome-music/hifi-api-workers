export class ApiError extends Error {
  status: number
  detail: string
  headers?: HeadersInit

  constructor(status: number, detail: string, headers?: HeadersInit) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.headers = headers
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
