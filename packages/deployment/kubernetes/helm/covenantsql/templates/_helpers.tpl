{{/*
Expand the name of the chart.
*/}}
{{- define "sqlit.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "sqlit.fullname" -}}
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
{{- define "sqlit.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "sqlit.labels" -}}
helm.sh/chart: {{ include "sqlit.chart" . }}
{{ include "sqlit.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "sqlit.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sqlit.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Block Producer labels
*/}}
{{- define "sqlit.bpLabels" -}}
{{ include "sqlit.labels" . }}
app.kubernetes.io/component: block-producer
{{- end }}

{{/*
Block Producer selector labels
*/}}
{{- define "sqlit.bpSelectorLabels" -}}
{{ include "sqlit.selectorLabels" . }}
app.kubernetes.io/component: block-producer
{{- end }}

{{/*
Miner labels
*/}}
{{- define "sqlit.minerLabels" -}}
{{ include "sqlit.labels" . }}
app.kubernetes.io/component: miner
{{- end }}

{{/*
Miner selector labels
*/}}
{{- define "sqlit.minerSelectorLabels" -}}
{{ include "sqlit.selectorLabels" . }}
app.kubernetes.io/component: miner
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "sqlit.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "sqlit.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
