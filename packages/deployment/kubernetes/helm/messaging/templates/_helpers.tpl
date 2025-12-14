{{/*
Expand the name of the chart.
*/}}
{{- define "messaging.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "messaging.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "messaging.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "messaging.labels" -}}
helm.sh/chart: {{ include "messaging.chart" . }}
{{ include "messaging.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "messaging.selectorLabels" -}}
app.kubernetes.io/name: {{ include "messaging.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account for relay
*/}}
{{- define "messaging.serviceAccountName" -}}
{{- if .Values.relay.serviceAccount.create }}
{{- default (printf "%s-relay" (include "messaging.fullname" .)) .Values.relay.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.relay.serviceAccount.name }}
{{- end }}
{{- end }}

