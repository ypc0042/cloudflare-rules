export interface AssetsPort {
  fetch(request: Request): Promise<Response>;
}
