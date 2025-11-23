document.addEventListener('DOMContentLoaded', () => {
    // Tab switching functionality
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.tabTarget;

            tabButtons.forEach(btn => btn.classList.remove('is-active'));
            tabPanels.forEach(panel => panel.classList.remove('is-active'));

            button.classList.add('is-active');
            document.getElementById(targetId).classList.add('is-active');
        });
    });

    // Photo upload functionality
    const dropZone = document.getElementById('drop-zone');
    const photoInput = document.getElementById('photo-input');
    const browseButton = document.getElementById('browse-button');
    const uploadList = document.getElementById('upload-list');
    const photoGallery = document.getElementById('photo-gallery');
    const photoEmpty = document.getElementById('photo-empty');
    const uploadStatus = document.getElementById('upload-status');

    if (dropZone && photoInput && browseButton && uploadList && photoGallery && photoEmpty && uploadStatus) {
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Highlight drop zone when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('active'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('active'), false);
        });

        // Handle dropped files
        dropZone.addEventListener('drop', handleDrop, false);

        function handleDrop(e) {
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
        }

        // Handle browse button click
        browseButton.addEventListener('click', () => photoInput.click());
        photoInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });

        let uploadedFiles = [];

        function handleFiles(files) {
            if (files.length === 0) {
                uploadStatus.textContent = 'No files selected.';
                return;
            }

            uploadStatus.textContent = `Uploading ${files.length} file(s)...`;

            Array.from(files).forEach(file => {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        // Simulate upload and add to gallery
                        const img = document.createElement('div');
                        img.className = 'photo-thumb';
                        img.style.backgroundImage = `url(${e.target.result})`;
                        img.dataset.src = e.target.result; // Store full image src for viewer

                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'photo-thumb__delete';
                        deleteBtn.textContent = '✕';
                        deleteBtn.addEventListener('click', (event) => {
                            event.stopPropagation(); // Prevent opening viewer
                            img.remove();
                            uploadedFiles = uploadedFiles.filter(f => f.src !== img.dataset.src);
                            updatePhotoGalleryStatus();
                        });

                        img.appendChild(deleteBtn);
                        photoGallery.appendChild(img);
                        uploadedFiles.push({ src: e.target.result, name: file.name, type: file.type });
                        updatePhotoGalleryStatus();
                    };
                    reader.readAsDataURL(file);
                }
            });

            uploadStatus.textContent = `${files.length} file(s) processed.`;
            photoInput.value = ''; // Clear file input for next upload
        }

        function updatePhotoGalleryStatus() {
            if (uploadedFiles.length > 0) {
                photoEmpty.hidden = true;
            } else {
                photoEmpty.hidden = false;
            }
        }
        updatePhotoGalleryStatus(); // Initial check
    }

    // Checklist functionality (Forms, Consents, Consultations)
    document.querySelectorAll('.checklist').forEach(checklist => {
        checklist.addEventListener('click', (e) => {
            if (e.target.classList.contains('checklist-remove')) {
                e.target.closest('.checklist-item').remove();
            }
        });
    });

    // Simple Photo Viewer (retained from original patient.js, ensure elements exist in HTML)
    const photoViewer = document.getElementById('photo-viewer');
    const photoViewerImage = document.getElementById('photo-viewer-image');
    const photoViewerClose = document.getElementById('photo-viewer-close');
    const photoViewerPrev = document.getElementById('photo-viewer-prev');
    const photoViewerNext = document.getElementById('photo-viewer-next');
    const photoViewerDelete = document.getElementById('photo-viewer-delete');

    let currentPhotoIndex = 0;

    if (photoViewer && photoViewerImage && photoViewerClose && photoViewerPrev && photoViewerNext && photoViewerDelete) {
        photoGallery.addEventListener('click', (e) => {
            const thumb = e.target.closest('.photo-thumb');
            if (thumb && !e.target.classList.contains('photo-thumb__delete')) {
                const photos = Array.from(photoGallery.querySelectorAll('.photo-thumb'));
                currentPhotoIndex = photos.indexOf(thumb);
                showPhotoInViewer(currentPhotoIndex);
            }
        });

        photoViewerClose.addEventListener('click', () => {
            photoViewer.hidden = true;
        });

        photoViewerPrev.addEventListener('click', () => {
            currentPhotoIndex = (currentPhotoIndex > 0) ? currentPhotoIndex - 1 : uploadedFiles.length - 1;
            showPhotoInViewer(currentPhotoIndex);
        });

        photoViewerNext.addEventListener('click', () => {
            currentPhotoIndex = (currentPhotoIndex < uploadedFiles.length - 1) ? currentPhotoIndex + 1 : 0;
            showPhotoInViewer(currentPhotoIndex);
        });

        photoViewerDelete.addEventListener('click', () => {
            if (uploadedFiles.length > 0) {
                const photoToDelete = photoGallery.children[currentPhotoIndex];
                if (photoToDelete) {
                    photoToDelete.remove();
                    uploadedFiles.splice(currentPhotoIndex, 1);
                    updatePhotoGalleryStatus();

                    if (uploadedFiles.length === 0) {
                        photoViewer.hidden = true;
                    } else {
                        currentPhotoIndex = Math.min(currentPhotoIndex, uploadedFiles.length - 1);
                        showPhotoInViewer(currentPhotoIndex);
                    }
                }
            }
        });

        function showPhotoInViewer(index) {
            if (uploadedFiles.length === 0) {
                photoViewer.hidden = true;
                return;
            }
            photoViewerImage.src = uploadedFiles[index].src;
            // You can add a caption if needed: photoViewerCaption.textContent = uploadedFiles[index].name;
            photoViewer.hidden = false;
        }
    }
});