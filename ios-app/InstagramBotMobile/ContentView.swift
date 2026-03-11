import SwiftUI

struct BotStatus: Codable {
  let credentialsConfigured: Bool
  let username: String?
  let cronExpression: String
  let schedulerCurrentlyRunning: Bool
  let categoriesCount: Int
  let threadsCount: Int
}

struct StatusResponse: Codable {
  let credentialsConfigured: Bool
  let username: String?
  let cronExpression: String
  let schedulerCurrentlyRunning: Bool
  let categoriesCount: Int
  let threadsCount: Int
}

struct APIErrorResponse: Codable {
  let message: String?
}

@MainActor
final class BotViewModel: ObservableObject {
  @Published var baseURL: String = "http://127.0.0.1:8787"
  @Published var username: String = ""
  @Published var password: String = ""
  @Published var cronExpression: String = "0 9,18 * * *"
  @Published var status: BotStatus?
  @Published var feedback: String = ""
  @Published var isLoading: Bool = false

  func refreshStatus() async {
    await withRequestState {
      guard let url = URL(string: "\(self.baseURL)/api/status") else {
        throw URLError(.badURL)
      }
      let (data, response) = try await URLSession.shared.data(from: url)
      try self.validate(response: response, data: data)
      let payload = try JSONDecoder().decode(StatusResponse.self, from: data)
      self.status = BotStatus(
        credentialsConfigured: payload.credentialsConfigured,
        username: payload.username,
        cronExpression: payload.cronExpression,
        schedulerCurrentlyRunning: payload.schedulerCurrentlyRunning,
        categoriesCount: payload.categoriesCount,
        threadsCount: payload.threadsCount
      )
      self.feedback = "Status refreshed"
    }
  }

  func saveCredentials() async {
    await postJSON(path: "/api/credentials", body: [
      "username": username,
      "password": password,
    ], successMessage: "Credentials saved")
  }

  func updateSchedule() async {
    await postJSON(path: "/api/schedule", body: [
      "cronExpression": cronExpression,
    ], successMessage: "Schedule updated")
  }

  func sendNow() async {
    await postJSON(path: "/api/send-now", body: [:], successMessage: "Send now triggered")
  }

  private func postJSON(path: String, body: [String: Any], successMessage: String) async {
    await withRequestState {
      guard let url = URL(string: "\(self.baseURL)\(path)") else {
        throw URLError(.badURL)
      }

      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)

      let (data, response) = try await URLSession.shared.data(for: request)
      try self.validate(response: response, data: data)
      self.feedback = successMessage
    }
  }

  private func validate(response: URLResponse, data: Data) throws {
    guard let http = response as? HTTPURLResponse else { return }
    guard (200...299).contains(http.statusCode) else {
      let message = (try? JSONDecoder().decode(APIErrorResponse.self, from: data).message) ??
        "Request failed with status \(http.statusCode)"
      throw NSError(domain: "BotAPI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
    }
  }

  private func withRequestState(_ work: @escaping () async throws -> Void) async {
    isLoading = true
    defer { isLoading = false }

    do {
      try await work()
    } catch {
      feedback = error.localizedDescription
    }
  }
}

struct ContentView: View {
  @StateObject private var viewModel = BotViewModel()

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          GroupBox("API") {
            TextField("Base URL", text: $viewModel.baseURL)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .textFieldStyle(.roundedBorder)
          }

          GroupBox("Status") {
            VStack(alignment: .leading, spacing: 8) {
              if let status = viewModel.status {
                Text("Credentials: \(status.credentialsConfigured ? "Configured" : "Missing")")
                Text("Username: \(status.username ?? "-")")
                Text("Schedule: \(status.cronExpression)")
                Text("Scheduler running: \(status.schedulerCurrentlyRunning ? "Yes" : "No")")
                Text("Categories: \(status.categoriesCount)")
                Text("Threads: \(status.threadsCount)")
              } else {
                Text("No status loaded")
              }
              Button("Refresh") {
                Task { await viewModel.refreshStatus() }
              }
            }
          }

          GroupBox("Credentials") {
            VStack(spacing: 8) {
              TextField("Username", text: $viewModel.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
              SecureField("Password", text: $viewModel.password)
                .textFieldStyle(.roundedBorder)
              Button("Save Credentials") {
                Task { await viewModel.saveCredentials() }
              }
            }
          }

          GroupBox("Schedule") {
            VStack(spacing: 8) {
              TextField("Cron Expression", text: $viewModel.cronExpression)
                .textFieldStyle(.roundedBorder)
              Button("Update Schedule") {
                Task { await viewModel.updateSchedule() }
              }
            }
          }

          Button("Send Reels Now") {
            Task { await viewModel.sendNow() }
          }
          .buttonStyle(.borderedProminent)

          if viewModel.isLoading {
            ProgressView()
          }

          Text(viewModel.feedback)
            .foregroundStyle(.secondary)
            .font(.footnote)
        }
        .padding()
      }
      .navigationTitle("Instagram Bot")
    }
  }
}
